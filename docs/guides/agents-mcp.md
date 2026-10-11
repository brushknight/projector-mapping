# Agents over MCP

Claude Code, Codex and any other MCP client can read the scene, look at what the projector would show, write effects
and clips, and hand you a proposal. You do what only a person can do (aim the projector, outline the objects or run
auto map); the agent does the creative work. The design is in [../mcp-plan.md](../mcp-plan.md).

## Connect

The server speaks MCP over streamable HTTP at `http://127.0.0.1:7400/mcp`. `projmap mcp` is a stdio bridge to it, and
starts the server in the background when it is not running.

### Claude Code

```bash
claude mcp add projmap -- ~/.local/bin/projmap mcp
```

Or, while the server runs, over HTTP:

```bash
claude mcp add --transport http projmap http://127.0.0.1:7400/mcp
```

Check it with `claude mcp list`, then ask Claude something like "use projmap: describe the current scene".

### Codex

In `~/.codex/config.toml` (use the full path; `~` is not expanded):

```toml
[mcp_servers.projmap]
command = "/Users/you/.local/bin/projmap"
args = ["mcp"]
```

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
| write (draft) | `surface_create`, `surface_update`, `surface_nudge`, `surface_create_from_camera`, `effect_create`, `effect_update`, `clip_add`, `cue_add`, `draft_diff` |
| act | `calibration_run`, `detect_surfaces`, `alignment_error`, `projector_show`, `preview_on_projector`, `transport` |
| hand-off | `proposal_submit` |

Resources: `scene://current`, `effects://catalog`, `docs://effect-api`, `docs://style-guide`. Prompts:
`animate-object` and `reveal-sequence` start the agent with a good loop (read, look, write, check, propose).

`output_render` needs a renderer: keep the editor or `/out` open in a browser on the server's machine.

## Drafts, proposals and the two toggles

- Everything an agent writes goes into a **draft**, a backstage copy of the scene. The wall does not change.
- The agent finishes with `proposal_submit`. The editor's agent panel shows the proposal with **apply**, **preview**
  (the stage shows the draft) and **discard**.
- Two toggles in the agent panel, both **off** by default:
  - **agent may preview on projector**: lets the agent show patterns, outlines and its draft on the real projector
    (needed for `camera_compare`, `alignment_error` and `preview_on_projector`);
  - **agent may go live**: lets the agent use the transport (play, GO, blackout) on air.
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
