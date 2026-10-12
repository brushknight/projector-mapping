# Editor UX research (2026-10-12)

The question: how other mapping tools handle per-face (unwrapped) content editing, previewing animations, and
getting a newcomer from nothing to mapped and playing.

## Findings

Every mature tool splits **content space** (input, UV, slice) from **mapping space** (the output warp):

- MadMapper: Input view and Output view.
- Resolume: Input Selection and Output Transformation.
- Millumin: slice and mapping.
- kantanMapper: a texture editor per shape.
- MapMap: separate input and output editors.

## Patterns, ranked

1. A per-face content canvas, separate from the warp.
2. A local editor preview clock, separate from on air. MadMapper plays media live in both views; Millumin's
   "freeze outputs" previews without touching the projector.
3. Solo the selected face, and black out everything else (VPT, MadMapper).
4. An unfolded atlas per object, so content can flow across shared edges (UV workflows).
5. Template export and import (MadMapper, Resolume and Millumin all export SVG/PNG; Blender exports UV layouts).
6. Effects on groups of faces (HeavyM).
7. A 4-step onboarding rail (MadMapper's documented workflow, Lightform).
8. A test card drawn through each face's warp (Resolume).

## Options

- **A, light touch.** Preview in every workspace, a promoted "edit face" split view, solo.
- **B, two spaces on one screen.** A Map | Content toggle, an unfolded atlas per object, a picture-in-picture warped
  preview, the animate workspace merged into a collapsible timeline. **Recommended.**
- **C, face-first.** Zoom into a face to edit it, context cards, the timeline behind "Advanced".

Sources: MadMapper UI PDF, resolume.com/support/en/input-selection, help.heavym.net, help.millumin.com,
docs.derivative.ca/Palette:kantanMapper, lightform.com/creator, mapmapteam.github.io, the VPT manual,
docs.blender.org (UV export).
