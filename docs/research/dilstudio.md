# Dil Studio / dil.map: what to learn (researched 2026-10-11)

Dil Studio is a projection-mapping product for artists with cheap smart projectors. The pieces:

- a browser studio (Next.js);
- **dil.map**, an Android TV app that runs on the projector itself;
- **Dil.Outpost**, a macOS HDMI output.

It is freemium SaaS: $0, $11.99 or $39.99 a month, with caps on surfaces, scenes and devices, plus a watermark. It
needs a cloud account. Surfaces are manual only: shapes, masks and mesh/bezier, with no camera-based geometry. Its AI
works on content: depth and segmentation of a still photo, used to confine effects to regions. Sources and full notes
are in the research report in the session that produced this file.

## Candidates to adopt, ranked

| # | idea | where in our plan |
| --- | --- | --- |
| 1 | **Prepare and GO.** Outputs prefetch assets and acknowledge they're ready before GO. The phone shows a "ready" pill. The output keeps running the show and reports its cue position live even if the network drops. | M4 transport, phone objects tab |
| 2 | **Depth and segmentation of a set photo.** iPhone LiDAR/Vision depth plus subject segmentation, so a layer can be confined to "background / subject / region N" (for example fog that keeps the subject clear, or god-rays behind it). | M5 "new scene from photo", M2 layers get a `mask` param |
| 3 | **QR on the projector that opens the phone app** (deep link `projmap://connect`). | M0 pairing (already in the frontend brief) |
| 4 | **Patterns that expire to black automatically,** so a grid never stays lit on camera. | M3 test patterns, M7 calibration |
| 5 | **Seeded variations with a "re-roll" button,** where 0 is the original. | M4 effect params, phone live-layer sheet |
| 6 | **Timeline record mode:** perform a slider or surface move live and it becomes keyframes, plus "copy start to end" for loops. | M4 timeline |
| 7 | **Contour-aware effects,** with particles flowing along an object's silhouette. | M4 built-ins |
| 8 | **Music-reactive bindings.** | after M8 |
| 9 | **Startup scene and autoplay** per setup. | M8 |
| 10 | **Content-hash pinned effect revisions,** so the preview and the projector render identical code. | effects catalog |

## Deliberately not copying

- Cloud accounts, subscription caps and watermarks.
- Rendering on an Android TV projector SoC.
- Effects baked into MP4/HLS.
- A browser-only phone controller.
- Shape-only surface setup. Camera geometry plus agents is our differentiator.
- Multi-projector edge-blend machinery.
- Pose tracking as a core feature.
