# Agents over MCP

Claude Code, Codex and any other MCP client can read the scene, look at what the projector would show, write effects
and clips, and hand you a proposal. You do what only a person can do (aim the projector, outline the objects or run
auto map); the agent does the creative work. The design is in [../mcp-plan.md](../mcp-plan.md).

## Connect

The server speaks MCP over streamable HTTP at `http://localhost:7400/mcp`. `projmap mcp` is a stdio bridge to it, and
starts the server in the background when it is not running.

How the bridge finds the server: `--url` when you pass it, else `$PROJMAP_URL` + `/mcp`, else
`http://127.0.0.1:$PROJMAP_PORT/mcp` (port 7400 by default). A client on the server's own Mac needs no token.

### Claude Code

Use the absolute path of the binary (the installer puts it in `~/.local/bin`):

```bash
claude mcp add --scope user projmap -- /Users/you/.local/bin/projmap mcp
```

`--scope user` makes projmap available in every project. Or, while the server runs, over HTTP:

```bash
claude mcp add --scope user --transport http projmap http://localhost:7400/mcp
```

Check it with `claude mcp list` (projmap shows as connected), then ask Claude something like "use projmap: describe
the current scene", or start the drawing loop with the `dress-object` prompt (`/mcp__projmap__dress-object`).

### Codex

Add this block to `~/.codex/config.toml` (use the full path; `~` is not expanded there):

```toml
[mcp_servers.projmap]
command = "/Users/you/.local/bin/projmap"
args = ["mcp"]
```

Codex starts the bridge when it starts a session. To reach a server on another port, add
`env = { PROJMAP_URL = "http://127.0.0.1:7411" }` to the block.

### Another machine

A client on the server's own machine needs no token. From another machine, pass a device or agent token and the
server's URL:

```bash
projmap mcp --url http://studio-mac.local:7400/mcp --token <token>
```

## What the agent can do

| group | tools (examples) |
| --- | --- |
| read | `scene_get`, `surface_get`, `timeline_get`, `effects_list`, `effect_source_get`, `reference_photo_get` |
| look | `output_render` (a PNG of the frame at time t), `output_render_strip` (a contact sheet), `camera_snapshot`, `camera_compare` |
| read faces | `object_unfold_get`, `face_get` |
| look at faces | `face_template_get`, `face_render`, `object_unfold_render` |
| write (draft) | `surface_create`, `surface_update`, `surface_nudge`, `surface_create_from_camera`, `effect_create`, `effect_update`, `clip_add`, `cue_add`, `draft_diff` |
| draw (draft) | `face_draw`, `face_drawing_clear`, `object_draw`, `layer_add`, `layer_update`, `layer_remove`, `asset_upload` |
| act | `calibration_run`, `detect_surfaces`, `alignment_error`, `projector_show`, `preview_on_projector`, `transport` |
| hand-off | `proposal_submit`, `draft_apply` (needs "agent may apply") |

Resources: `scene://current`, `effects://catalog`, `docs://effect-api`, `docs://style-guide`, `docs://drawing`.
Prompts: `animate-object`, `reveal-sequence` and `dress-object` start the agent with a good loop (read, look, write,
check, propose).

`output_render`, `face_render` and `object_unfold_render` render in a browser: keep the editor
(http://localhost:7400/editor) or `/out` open in Chrome on the server's machine. Without one, `face_render` and
`object_unfold_render` fall back to a built-in approximation (drawings, gradients and PNG/JPEG pictures) and say so,
and `output_render` asks you to open the editor. `face_template_get` never needs a browser.

## Dress an object: draw the real device on its faces

After you map an object (for example the three faces of a ZimaCube and its four drive bays), ask the agent to make it
look like the real thing:

> use projmap's dress-object prompt for obj_cube, device "ZimaCube NAS"

The agent then:

1. reads the unfold (`object_unfold_get`): each face's real aspect, which edge touches which, and the mapped details;
2. looks at templates (`face_template_get`) so it knows where u and v run on each face;
3. draws per face in named layers (`face_draw` with `layer_name` "bays", "logo", "leds"…): points are the face's UV,
   (0,0) at its first corner, u toward the second, v toward the fourth;
4. looks at each face flat (`face_render`, from its draft), compares, and redraws a layer with `mode: "replace"`;
5. checks the whole object (`object_unfold_render`, `output_render`) and hands you a proposal.

Pictures work too: the agent can write an SVG or PNG, `asset_upload` it and place it on a face with `layer_add`.

## Drafts, proposals and the two toggles

- Everything an agent writes goes into a **draft**, a backstage copy of the scene. The wall does not change.
- The agent finishes with `proposal_submit`. The editor's agent panel shows the proposal with **apply**, **preview**
  (the stage shows the draft) and **discard**.
- Proposals from Claude Code or Codex sessions you started yourself (outside the editor) show in the agent panel
  too, a few seconds after their first write, as "claude over MCP" or "codex over MCP".
- Three toggles in the agent panel, all **off** by default:
  - **agent may preview on projector**: lets the agent show patterns, outlines and its draft on the real projector
    (needed for `camera_compare`, `alignment_error` and `preview_on_projector`);
  - **agent may go live**: lets the agent use the transport (play, GO, blackout) on air;
  - **agent may apply its drafts**: lets the agent put its own draft on the live scene with `draft_apply`. The
    same switch over the API: `curl -X PATCH -H 'Content-Type: application/json' -d '{"agentMayApply": true}'
    http://localhost:7400/api/v1/settings`.
- Every agent change is one history entry, so you can undo it.

## Start an agent from the editor or the phone

The agent panel (editor) and auto map (phone) have a prompt box with a Claude or Codex switch. The server then runs
the agent on its own machine with projmap attached:

- Claude: `claude -p` with a scoped token, limited to the projmap tools;
- Codex: `codex exec --json` in a read-only sandbox, with `projmap mcp --token` as its MCP server.

The tool calls and messages stream to the editor and the phone. **stop** ends the run, and the token is revoked when
it finishes. The `claude` or `codex` CLI must be installed and logged in on the server's machine and on the `PATH` of
the server process (the launchd agent adds `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin`). If one is
missing, starting it answers with a clear error.

## Writing effects

Agents write effects in GLSL (preferred) or JavaScript against the contract in [../effects.md](../effects.md), which
they can also read as the `docs://effect-api` resource. `effect_create` checks the source and reports errors back to
the agent; the renderer compiles it.

## Safety

- The MCP endpoint has the same auth as the rest of the API: the server's own machine is trusted, everything else
  needs a token.
- GLSL effects only reach their uniforms. JS effects run in a worker with no DOM and no network, and are switched
  off when they go over their frame budget.
- Agents never change the live scene unless you apply their proposal or turn on "agent may go live".
