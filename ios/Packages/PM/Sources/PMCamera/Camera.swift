import Foundation
import PMKit
#if os(iOS)
import AVFoundation
import CoreImage
import CoreMotion
import SwiftUI
import UIKit

public enum CameraError: Error, LocalizedError {
    case denied, unavailable, captureFailed
    public var errorDescription: String? {
        switch self {
        case .denied: "projmap may not use the camera. Allow it in Settings."
        case .unavailable: "This iPhone has no back camera available."
        case .captureFailed: "The photo could not be taken."
        }
    }
}

/// What the preview frames say about the scene (for the auto-map checklist).
public struct SceneLight: Sendable, Equatable {
    /// Mean luma 0…1.
    public var mean: Double
    /// Share of very bright pixels (the projector's light).
    public var bright: Double
    public var projectorInFrame: Bool { bright > 0.02 && bright < 0.7 }
    public var dim: Bool { mean < 0.28 }
    public init(mean: Double, bright: Double) { self.mean = mean; self.bright = bright }
}

/// The back camera: a preview session, JPEG preview frames (~8 fps, 960 px) for the `camera` channel, and
/// full-resolution stills with exposure, ISO, focus and white balance locked (answers `camera.capture`).
public final class CameraController: NSObject, @unchecked Sendable {
    public let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "projmap.camera")
    private let photoOutput = AVCapturePhotoOutput()
    private let videoOutput = AVCaptureVideoDataOutput()
    private var device: AVCaptureDevice?
    private var configured = false
    private let ci = CIContext(options: [.useSoftwareRenderer: false])
    private var lastFrame: CFTimeInterval = 0
    private var seq = 0
    private var photoWaiters: [Int64: CheckedContinuation<Data, Error>] = [:]

    /// Frames per second for preview frames and their width in pixels.
    public var frameRate: Double = 8
    public var frameWidth: CGFloat = 960
    /// Called on a background queue with each preview frame.
    public var onFrame: (@Sendable (CameraFrame) -> Void)?
    /// Called on a background queue with the light analysis of each preview frame.
    public var onLight: (@Sendable (SceneLight) -> Void)?

    public override init() { super.init() }

    public static var authorized: Bool { AVCaptureDevice.authorizationStatus(for: .video) == .authorized }

    /// Asks for permission, configures the session and starts it.
    public func start() async throws {
        if AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .video)
        }
        guard Self.authorized else { throw CameraError.denied }
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            queue.async {
                do {
                    try self.configure()
                    if !self.session.isRunning { self.session.startRunning() }
                    cont.resume()
                } catch { cont.resume(throwing: error) }
            }
        }
    }

    public func stop() {
        queue.async { if self.session.isRunning { self.session.stopRunning() } }
    }

    private func configure() throws {
        guard !configured else { return }
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else { throw CameraError.unavailable }
        self.device = device
        session.beginConfiguration()
        session.sessionPreset = .photo
        let input = try AVCaptureDeviceInput(device: device)
        if session.canAddInput(input) { session.addInput(input) }
        if session.canAddOutput(photoOutput) { session.addOutput(photoOutput) }
        photoOutput.maxPhotoQualityPrioritization = .quality
        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        videoOutput.setSampleBufferDelegate(self, queue: queue)
        if session.canAddOutput(videoOutput) { session.addOutput(videoOutput) }
        session.commitConfiguration()
        configured = true
    }

    /// Locks exposure, ISO, focus and white balance where they are now (calibration needs frames that match).
    public func lock(_ on: Bool) async {
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            queue.async {
                defer { cont.resume() }
                guard let d = self.device, (try? d.lockForConfiguration()) != nil else { return }
                if on {
                    if d.isFocusModeSupported(.locked) { d.focusMode = .locked }
                    if d.isExposureModeSupported(.locked) { d.exposureMode = .locked }
                    if d.isWhiteBalanceModeSupported(.locked) { d.whiteBalanceMode = .locked }
                } else {
                    if d.isFocusModeSupported(.continuousAutoFocus) { d.focusMode = .continuousAutoFocus }
                    if d.isExposureModeSupported(.continuousAutoExposure) { d.exposureMode = .continuousAutoExposure }
                    if d.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) { d.whiteBalanceMode = .continuousAutoWhiteBalance }
                }
                d.unlockForConfiguration()
            }
        }
    }

    /// A full-resolution JPEG still; with `lock` the camera settings stay locked afterwards (a calibration takes many).
    public func captureStill(lock: Bool) async throws -> Data {
        if !session.isRunning { try await start() }
        if lock { await self.lock(true) }
        return try await withCheckedThrowingContinuation { cont in
            queue.async {
                let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
                settings.flashMode = .off
                self.photoWaiters[settings.uniqueID] = cont
                self.photoOutput.capturePhoto(with: settings, delegate: self)
            }
        }
    }
}

extension CameraController: AVCapturePhotoCaptureDelegate {
    public func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let id = photo.resolvedSettings.uniqueID
        queue.async {
            guard let cont = self.photoWaiters.removeValue(forKey: id) else { return }
            if let data = photo.fileDataRepresentation(), error == nil { cont.resume(returning: data) } else { cont.resume(throwing: error ?? CameraError.captureFailed) }
        }
    }
}

extension CameraController: AVCaptureVideoDataOutputSampleBufferDelegate {
    public func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let now = CACurrentMediaTime()
        guard now - lastFrame >= 1 / frameRate, let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        lastFrame = now
        var image = CIImage(cvPixelBuffer: pixels)
        let scale = min(1, frameWidth / image.extent.width)
        image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        if let onLight {
            onLight(analyze(image))
        }
        guard let onFrame, let jpeg = ci.jpegRepresentation(of: image, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                                                            options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.6]) else { return }
        seq += 1
        onFrame(CameraFrame(seq: seq, width: Int(image.extent.width), height: Int(image.extent.height), jpeg: jpeg.base64EncodedString()))
    }

    /// Mean luma and the share of near-white pixels, from a 32×24 thumbnail.
    private func analyze(_ image: CIImage) -> SceneLight {
        let w = 32, h = 24
        let small = image.transformed(by: CGAffineTransform(scaleX: CGFloat(w) / image.extent.width, y: CGFloat(h) / image.extent.height))
        var buf = [UInt8](repeating: 0, count: w * h * 4)
        ci.render(small, toBitmap: &buf, rowBytes: w * 4, bounds: CGRect(x: 0, y: 0, width: w, height: h), format: .RGBA8, colorSpace: nil)
        var sum = 0.0, bright = 0
        for i in 0..<(w * h) {
            let l = (0.2126 * Double(buf[i * 4]) + 0.7152 * Double(buf[i * 4 + 1]) + 0.0722 * Double(buf[i * 4 + 2])) / 255
            sum += l
            if l > 0.85 { bright += 1 }
        }
        return SceneLight(mean: sum / Double(w * h), bright: Double(bright) / Double(w * h))
    }
}

/// The live camera image (aspect fill).
public struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    public init(session: AVCaptureSession) { self.session = session }

    public func makeUIView(context: Context) -> PreviewView {
        let v = PreviewView()
        v.layer.masksToBounds = true
        v.previewLayer.session = session
        v.previewLayer.videoGravity = .resizeAspectFill
        return v
    }

    public func updateUIView(_ view: PreviewView, context: Context) {}

    public final class PreviewView: UIView {
        public override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}

/// Steadiness and level from CoreMotion: `steady` after 3 s without motion, `level` = roll in degrees from the
/// nearest upright or landscape position.
@MainActor
@Observable
public final class MotionMonitor {
    public private(set) var steady = false
    public private(set) var level: Double = 0
    public private(set) var available: Bool
    private let manager = CMMotionManager()
    private var stillSince: Date?

    public init() { available = manager.isDeviceMotionAvailable }

    public func start() {
        guard manager.isDeviceMotionAvailable, !manager.isDeviceMotionActive else { return }
        manager.deviceMotionUpdateInterval = 1.0 / 20
        manager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let self, let m = motion else { return }
            MainActor.assumeIsolated { self.update(m) }
        }
    }

    public func stop() { manager.stopDeviceMotionUpdates() }

    private func update(_ m: CMDeviceMotion) {
        let r = m.rotationRate, a = m.userAcceleration
        let moving = abs(r.x) + abs(r.y) + abs(r.z) > 0.06 || abs(a.x) + abs(a.y) + abs(a.z) > 0.03
        let now = Date()
        if moving { stillSince = nil } else if stillSince == nil { stillSince = now }
        steady = stillSince.map { now.timeIntervalSince($0) >= 3 } ?? false
        let g = m.gravity
        let roll = atan2(g.x, -g.y) * 180 / .pi
        let nearest = (roll / 90).rounded() * 90
        level = roll - nearest
    }
}
#endif
