import Foundation
import CoreGraphics
import PMKit
/// What the preview frames say about the scene (for the auto-map checklist).
public struct SceneLight: Sendable, Equatable {
    /// Mean luma 0…1.
    public var mean: Double
    /// Share of the frame the projected light covers (pixels well above the room's level).
    public var bright: Double
    /// The lit area's corners (top-left, top-right, bottom-right, bottom-left) in capture-device coordinates (0…1,
    /// the unrotated sensor frame, as `AVCaptureVideoPreviewLayer.layerPointConverted(fromCaptureDevicePoint:)` takes
    /// them). Empty when nothing stands out.
    public var quad: [CGPoint]
    /// The lit area runs off the edge of the frame (part of the projection is out of view).
    public var touchesEdge: Bool

    /// The projected light is in view and big enough to calibrate against.
    public var projectorInFrame: Bool { quad.count == 4 && bright > 0.06 && bright < 0.97 }
    public var dim: Bool { mean < 0.28 }
    public init(mean: Double, bright: Double, quad: [CGPoint] = [], touchesEdge: Bool = false) {
        self.mean = mean; self.bright = bright; self.quad = quad; self.touchesEdge = touchesEdge
    }

    /// Finds the lit area in a luma thumbnail (`w × h`, row 0 at the top, values 0…1): pixels brighter than both an
    /// absolute floor and a share of the brightest, then the extreme corners of that set.
    public static func analyze(luma: [Double], w: Int, h: Int) -> SceneLight {
        guard w > 0, h > 0, luma.count >= w * h else { return SceneLight(mean: 0, bright: 0) }
        let mean = luma.reduce(0, +) / Double(w * h)
        let sorted = luma.sorted()
        let top = sorted[Int(Double(sorted.count - 1) * 0.98)]
        let median = sorted[sorted.count / 2]
        // a projected area is clearly brighter than the room; a flat frame has no area
        guard top > 0.25, top - median > 0.12 || median > 0.6 else { return SceneLight(mean: mean, bright: 0) }
        let th = max(0.2, median + (top - median) * 0.5)
        var n = 0, edge = false
        var tl = (s: Double.infinity, p: CGPoint.zero), br = (s: -Double.infinity, p: CGPoint.zero)
        var tr = (s: -Double.infinity, p: CGPoint.zero), bl = (s: Double.infinity, p: CGPoint.zero)
        for y in 0..<h {
            for x in 0..<w where luma[y * w + x] > th {
                n += 1
                if x == 0 || y == 0 || x == w - 1 || y == h - 1 { edge = true }
                let p = CGPoint(x: (Double(x) + 0.5) / Double(w), y: (Double(y) + 0.5) / Double(h))
                let sum = p.x + p.y, diff = p.x - p.y
                if sum < tl.s { tl = (sum, p) }
                if sum > br.s { br = (sum, p) }
                if diff > tr.s { tr = (diff, p) }
                if diff < bl.s { bl = (diff, p) }
            }
        }
        let share = Double(n) / Double(w * h)
        guard n >= 4 else { return SceneLight(mean: mean, bright: share) }
        return SceneLight(mean: mean, bright: share, quad: [tl.p, tr.p, br.p, bl.p], touchesEdge: edge)
    }
}

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
    /// Called on a background queue with each preview frame and its `camera.frame` envelope text, built off the main
    /// thread (a 960 px frame is ~150 KB of base64; encoding it on the main actor stalled the preview and the status).
    public var onFrame: (@Sendable (CameraFrame, String) -> Void)?
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
        // Calibration needs the frame from after the request: zero shutter lag hands back a frame from the ring
        // buffer, taken before the projector showed the new pattern (every still was one pattern behind).
        if photoOutput.isZeroShutterLagSupported { photoOutput.isZeroShutterLagEnabled = false }
        if photoOutput.isResponsiveCaptureSupported { photoOutput.isResponsiveCaptureEnabled = false }
        if photoOutput.isFastCapturePrioritizationSupported { photoOutput.isFastCapturePrioritizationEnabled = false }
        photoOutput.maxPhotoQualityPrioritization = .balanced
        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        videoOutput.setSampleBufferDelegate(self, queue: queue)
        if session.canAddOutput(videoOutput) { session.addOutput(videoOutput) }
        session.commitConfiguration()
        configured = true
        applyAutoDefaults(device)
    }

    /// Continuous focus, exposure and white balance with the highlights protected (a dark room otherwise makes auto
    /// exposure blow out the projected light) and no shutter slower than 1/30 s (a wobbly stand smears longer ones).
    private func applyAutoDefaults(_ d: AVCaptureDevice) {
        guard (try? d.lockForConfiguration()) != nil else { return }
        if d.isFocusModeSupported(.continuousAutoFocus) { d.focusMode = .continuousAutoFocus }
        if d.isSmoothAutoFocusSupported { d.isSmoothAutoFocusEnabled = false }
        if d.isFocusPointOfInterestSupported { d.focusPointOfInterest = CGPoint(x: 0.5, y: 0.5) }
        if d.isExposureModeSupported(.continuousAutoExposure) { d.exposureMode = .continuousAutoExposure }
        if d.isExposurePointOfInterestSupported { d.exposurePointOfInterest = CGPoint(x: 0.5, y: 0.5) }
        if d.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) { d.whiteBalanceMode = .continuousAutoWhiteBalance }
        let cap = CMTime(value: 1, timescale: 30)
        if CMTimeCompare(cap, d.activeFormat.minExposureDuration) >= 0, CMTimeCompare(cap, d.activeFormat.maxExposureDuration) <= 0 {
            d.activeMaxExposureDuration = cap
        }
        d.setExposureTargetBias(max(d.minExposureTargetBias, -1.0))
        d.unlockForConfiguration()
    }

    /// Waits (up to `timeout`) until focus and exposure stop adjusting.
    private func settle(_ d: AVCaptureDevice, timeout: Double = 2.5) async {
        let start = CACurrentMediaTime()
        try? await Task.sleep(for: .milliseconds(150))
        while CACurrentMediaTime() - start < timeout {
            if !d.isAdjustingFocus && !d.isAdjustingExposure && !d.isAdjustingWhiteBalance { return }
            try? await Task.sleep(for: .milliseconds(60))
        }
    }

    /// Focuses and exposes for one still at `point` (capture-device coordinates; the centre by default), waits for
    /// both to settle, captures, and returns the camera to continuous auto. Used for snapshots (agents, photos):
    /// never leaves the camera locked.
    public func captureSharpStill(at point: CGPoint? = nil) async throws -> Data {
        if !session.isRunning { try await start() }
        guard let d = device else { throw CameraError.unavailable }
        let p = point ?? CGPoint(x: 0.5, y: 0.5)
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            queue.async {
                defer { cont.resume() }
                guard (try? d.lockForConfiguration()) != nil else { return }
                if d.isFocusPointOfInterestSupported { d.focusPointOfInterest = p }
                if d.isFocusModeSupported(.autoFocus) { d.focusMode = .autoFocus }
                if d.isExposurePointOfInterestSupported { d.exposurePointOfInterest = p }
                if d.isExposureModeSupported(.continuousAutoExposure) { d.exposureMode = .continuousAutoExposure }
                d.unlockForConfiguration()
            }
        }
        await settle(d)
        defer { queue.async { self.applyAutoDefaults(d) } }
        return try await withCheckedThrowingContinuation { cont in
            queue.async {
                let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
                settings.flashMode = .off
                settings.photoQualityPrioritization = .balanced
                self.photoWaiters[settings.uniqueID] = cont
                self.photoOutput.capturePhoto(with: settings, delegate: self)
            }
        }
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
                    d.unlockForConfiguration()
                } else {
                    d.unlockForConfiguration()
                    self.applyAutoDefaults(d)
                }
            }
        }
    }

    /// Meters exposure and focus on `point` (capture-device coordinates, e.g. the middle of the projected area while
    /// it shows white), lets them settle, then locks exposure, focus and white balance. The projected white is then
    /// exposed right instead of being clipped while the room is averaged in.
    public func meterAndLock(at point: CGPoint?) async {
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            queue.async {
                defer { cont.resume() }
                guard let d = self.device, (try? d.lockForConfiguration()) != nil else { return }
                if let p = point {
                    if d.isExposurePointOfInterestSupported { d.exposurePointOfInterest = p }
                    if d.isFocusPointOfInterestSupported { d.focusPointOfInterest = p }
                }
                if d.isExposureModeSupported(.continuousAutoExposure) { d.exposureMode = .continuousAutoExposure }
                if d.isFocusModeSupported(.autoFocus) { d.focusMode = .autoFocus }
                if d.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) { d.whiteBalanceMode = .continuousAutoWhiteBalance }
                d.unlockForConfiguration()
            }
        }
        if let d = device { await settle(d, timeout: 3) } else { try? await Task.sleep(for: .milliseconds(900)) }
        await lock(true)
    }

    /// A full-resolution JPEG still; with `lock` the camera settings stay locked afterwards (a calibration takes many).
    public func captureStill(lock: Bool) async throws -> Data {
        if !session.isRunning { try await start() }
        if lock { await self.lock(true) }
        return try await withCheckedThrowingContinuation { cont in
            queue.async {
                let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
                settings.flashMode = .off
                settings.photoQualityPrioritization = .balanced
                self.photoWaiters[settings.uniqueID] = cont
                self.photoOutput.capturePhoto(with: settings, delegate: self)
            }
        }
    }
}

extension CameraController {
    /// Shrinks a JPEG to at most `maxWidth` pixels wide, keeping the sensor's pixel layout (no EXIF rotation applied,
    /// so camera pixels stay in the same frame as the preview and the server's calibration space).
    public static func downscale(jpeg: Data, maxWidth: Int) async -> Data {
        await Task.detached(priority: .userInitiated) {
            guard let img = CIImage(data: jpeg), img.extent.width > CGFloat(maxWidth) else { return jpeg }
            let k = CGFloat(maxWidth) / img.extent.width
            let small = img.transformed(by: CGAffineTransform(scaleX: k, y: k))
            let ctx = CIContext(options: [.useSoftwareRenderer: false])
            return ctx.jpegRepresentation(of: small, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                                          options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.9]) ?? jpeg
        }.value
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
        let frame = CameraFrame(seq: seq, width: Int(image.extent.width), height: Int(image.extent.height), jpeg: jpeg.base64EncodedString())
        onFrame(frame, Self.envelope(frame))
    }

    /// The light analysis from a 64×48 luma thumbnail (row 0 at the top of the sensor frame).
    private func analyze(_ image: CIImage) -> SceneLight {
        let w = 64, h = 48
        let small = image.transformed(by: CGAffineTransform(scaleX: CGFloat(w) / image.extent.width, y: CGFloat(h) / image.extent.height))
        var buf = [UInt8](repeating: 0, count: w * h * 4)
        ci.render(small, toBitmap: &buf, rowBytes: w * 4, bounds: CGRect(x: 0, y: 0, width: w, height: h), format: .RGBA8, colorSpace: nil)
        var luma = [Double](repeating: 0, count: w * h)
        for i in 0..<(w * h) {
            luma[i] = (0.2126 * Double(buf[i * 4]) + 0.7152 * Double(buf[i * 4 + 1]) + 0.0722 * Double(buf[i * 4 + 2])) / 255
        }
        return SceneLight.analyze(luma: luma, w: w, h: h)
    }

    /// `{"t":"camera.frame","ch":"camera","d":{…}}` without a JSONValue round trip (base64 needs no escaping).
    static func envelope(_ f: CameraFrame) -> String {
        "{\"t\":\"camera.frame\",\"ch\":\"camera\",\"d\":{\"seq\":\(f.seq),\"width\":\(f.width),\"height\":\(f.height),\"jpeg\":\"\(f.jpeg)\"}}"
    }
}

/// A shape drawn over the live camera image, in capture-device coordinates (0…1 of the sensor frame).
public struct PreviewShape: Sendable, Equatable {
    public enum Style: Sendable, Equatable { case solid, dashed, fill }
    public var points: [CGPoint]
    public var style: Style
    public init(points: [CGPoint], style: Style) { self.points = points; self.style = style }
}

/// The live camera image (aspect fill), with shapes in camera space drawn exactly over what the camera sees: the
/// preview layer converts sensor coordinates through its rotation and crop.
public struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    var shapes: [PreviewShape]
    var editingROI: Bool
    var onROI: (@MainActor (CGRect) -> Void)?
    /// With `editingROI`, a drag draws a box and `onROI` gets it in capture-device coordinates (0…1 of the sensor
    /// frame, the space of the calibration's camera pixels).
    public init(session: AVCaptureSession, shapes: [PreviewShape] = [], editingROI: Bool = false, onROI: (@MainActor (CGRect) -> Void)? = nil) {
        self.session = session; self.shapes = shapes; self.editingROI = editingROI; self.onROI = onROI
    }

    public func makeUIView(context: Context) -> PreviewView {
        let v = PreviewView()
        v.layer.masksToBounds = true
        v.previewLayer.session = session
        v.previewLayer.videoGravity = .resizeAspectFill
        v.shapes = shapes
        v.onROI = onROI
        v.pan.isEnabled = editingROI
        return v
    }

    public func updateUIView(_ view: PreviewView, context: Context) {
        if view.shapes != shapes { view.shapes = shapes }
        view.onROI = onROI
        view.pan.isEnabled = editingROI
    }

    public final class PreviewView: UIView {
        public override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
        private var shapeLayers: [CAShapeLayer] = []
        var shapes: [PreviewShape] = [] { didSet { redraw() } }
        var onROI: (@MainActor (CGRect) -> Void)?
        lazy var pan: UIPanGestureRecognizer = {
            let g = UIPanGestureRecognizer(target: self, action: #selector(dragged(_:)))
            addGestureRecognizer(g)
            return g
        }()
        private var dragStart: CGPoint?
        private let dragLayer = CAShapeLayer()

        @objc private func dragged(_ g: UIPanGestureRecognizer) {
            let p = g.location(in: self)
            switch g.state {
            case .began:
                dragStart = p
                dragLayer.strokeColor = UIColor.white.cgColor
                dragLayer.fillColor = UIColor.white.withAlphaComponent(0.1).cgColor
                dragLayer.lineWidth = 2
                dragLayer.lineDashPattern = [6, 4]
                layer.addSublayer(dragLayer)
            case .changed:
                guard let a = dragStart else { return }
                dragLayer.path = UIBezierPath(rect: CGRect(x: min(a.x, p.x), y: min(a.y, p.y), width: abs(p.x - a.x), height: abs(p.y - a.y))).cgPath
            case .ended:
                dragLayer.removeFromSuperlayer()
                guard let a = dragStart, abs(p.x - a.x) > 12, abs(p.y - a.y) > 12 else { return }
                let d0 = previewLayer.captureDevicePointConverted(fromLayerPoint: a)
                let d1 = previewLayer.captureDevicePointConverted(fromLayerPoint: p)
                let r = CGRect(x: min(d0.x, d1.x), y: min(d0.y, d1.y), width: abs(d1.x - d0.x), height: abs(d1.y - d0.y))
                    .intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
                if !r.isNull, r.width > 0.02, r.height > 0.02 { onROI?(r) }
            default:
                dragLayer.removeFromSuperlayer()
            }
        }

        public override func layoutSubviews() {
            super.layoutSubviews()
            redraw()
        }

        private func redraw() {
            shapeLayers.forEach { $0.removeFromSuperlayer() }
            shapeLayers = shapes.compactMap { s in
                guard s.points.count >= 2 else { return nil }
                let path = UIBezierPath()
                for (i, p) in s.points.enumerated() {
                    let q = previewLayer.layerPointConverted(fromCaptureDevicePoint: p)
                    if i == 0 { path.move(to: q) } else { path.addLine(to: q) }
                }
                path.close()
                let l = CAShapeLayer()
                l.path = path.cgPath
                l.lineWidth = 2
                l.lineJoin = .round
                let ink = UIColor(red: 0xF5 / 255, green: 0xF4 / 255, blue: 0xF0 / 255, alpha: 1)
                switch s.style {
                case .solid:
                    l.strokeColor = ink.cgColor
                    l.fillColor = ink.withAlphaComponent(0.12).cgColor
                case .dashed:
                    l.strokeColor = UIColor(red: 0x8C / 255, green: 0x8A / 255, blue: 0x85 / 255, alpha: 1).cgColor
                    l.fillColor = UIColor.clear.cgColor
                    l.lineDashPattern = [6, 4]
                case .fill:
                    l.strokeColor = ink.cgColor
                    l.fillColor = ink.withAlphaComponent(0.08).cgColor
                    l.lineWidth = 2.4
                }
                layer.addSublayer(l)
                return l
            }
        }
    }
}

/// Steadiness and level from CoreMotion. `steady` when the phone turned less than `steadyDegrees` over the last
/// `steadyWindow` seconds (a wobbly stand that settles counts; touching it briefly only clears it for 1.5 s);
/// `drift` is that rotation in degrees. `level` = roll in degrees from the nearest upright or landscape position.
@MainActor
@Observable
public final class MotionMonitor {
    public private(set) var steady = false
    public private(set) var drift: Double = 0
    public private(set) var level: Double = 0
    public private(set) var available: Bool
    public var steadyDegrees = 0.5
    public var steadyWindow = 1.5
    private let manager = CMMotionManager()
    private var samples: [(t: TimeInterval, q: CMQuaternion)] = []

    public init() { available = manager.isDeviceMotionAvailable }

    public func start() {
        guard manager.isDeviceMotionAvailable, !manager.isDeviceMotionActive else { return }
        manager.deviceMotionUpdateInterval = 1.0 / 20
        manager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let self, let m = motion else { return }
            MainActor.assumeIsolated { self.update(m) }
        }
    }

    public func stop() { manager.stopDeviceMotionUpdates(); samples = [] }

    private func update(_ m: CMDeviceMotion) {
        let now = m.timestamp
        let q = m.attitude.quaternion
        samples.append((now, q))
        samples.removeAll { now - $0.t > steadyWindow }
        let full = (samples.first.map { now - $0.t } ?? 0) >= steadyWindow - 0.15
        drift = samples.map { Self.angle(q, $0.q) }.max() ?? 0
        steady = full && drift < steadyDegrees
        let g = m.gravity
        let roll = atan2(g.x, -g.y) * 180 / .pi
        let nearest = (roll / 90).rounded() * 90
        level = roll - nearest
    }

    /// The rotation between two attitudes, in degrees.
    nonisolated static func angle(_ a: CMQuaternion, _ b: CMQuaternion) -> Double {
        let dot = abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)
        return 2 * acos(min(1, dot)) * 180 / .pi
    }
}
#endif
