import Foundation
import PMKit
import PMLive
import PMCamera

/// Connects the camera to the hub: answers `camera.capture` with a locked full-resolution still (uploaded to
/// `/camera/stills?request=…`, or `/assets` when the server sent no request id), and streams preview frames and
/// `camera.status` while auto map is open (protocol §5).
@MainActor
enum CameraBridge {
    static var streaming = false
    private static var statusTask: Task<Void, Never>?
    private static var lastSize = (0, 0)
    private static var generation = 0

    static func install(_ model: AppModel) {
        model.hub.handleRPC("camera.capture") { [weak model] args in
            guard let model, let api = model.api else { throw LiveError.notConnected }
            // Calibration takes many stills with the same locked settings (the auto map flow meters and locks first);
            // every other still (agent snapshots, photos) focuses and exposes on its own and leaves the camera in auto.
            let calibrating = args["purpose"]?.string == "calibration"
            var jpeg = calibrating
                ? try await model.camera.captureStill(lock: args["lock"]?.bool ?? true)
                : try await model.camera.captureSharpStill()
            if let w = args["maxWidth"]?.int, w > 0 { jpeg = await CameraController.downscale(jpeg: jpeg, maxWidth: w) }
            if let request = args["requestId"]?.string, !request.isEmpty {
                let sha = try await api.uploadStill(requestId: request, jpeg: jpeg)
                return ["sha": .string(sha)]
            }
            let asset = try await api.uploadAsset(jpeg, filename: "still.jpg", kind: args["purpose"]?.string == "scene" ? "photo" : "reference")
            return ["sha": .string(asset.sha)]
        }
    }

    static func startStreaming(_ model: AppModel) {
        let hub = model.hub
        generation += 1
        let gen = generation
        model.camera.onFrame = { frame, text in
            Task { @MainActor in
                guard streaming, generation == gen else { return }
                lastSize = (frame.width, frame.height)
                hub.sendCameraFrameText(text)
            }
        }
        statusTask?.cancel()
        let motion = MotionStatus.shared
        statusTask = Task { @MainActor in
            while streaming && !Task.isCancelled && generation == gen {
                hub.sendCameraStatus(CameraStatus(streaming: true, fps: model.camera.frameRate, width: lastSize.0, height: lastSize.1,
                                                  steady: motion.steady, level: motion.level))
                try? await Task.sleep(for: .seconds(1))
            }
            // only the last stream says it stopped: a restarted stream must not be overwritten by its predecessor
            if generation == gen && !streaming {
                hub.sendCameraStatus(CameraStatus(streaming: false, fps: 0, width: 0, height: 0, steady: false, level: 0))
            }
        }
    }

    static func stopStreaming(_ model: AppModel) {
        streaming = false
        model.camera.onFrame = nil
    }
}

/// The latest steadiness and level, shared with the status sender.
@MainActor
final class MotionStatus {
    static let shared = MotionStatus()
    var steady = false
    var level = 0.0
}
