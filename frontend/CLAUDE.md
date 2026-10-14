# frontend/ conventions

React 18 + TypeScript + Vite, TanStack Router (code-based tree in `src/router.tsx`), CSS Modules, no UI library, no
Tailwind. `npm run build` writes `../backend/internal/web/dist` (a plugin recreates `dist/.gitkeep`). Progress and
run commands: `docs/progress/frontend.md`. The wire contract is `docs/protocol.md`; effects: `docs/effects.md`.

## Layout

```
src/
  main.tsx, router.tsx                 routes: /out, /preview, /editor/$space (show, the landing space | map | content | automap; animate = map with the timeline open), /components
  shared/
    components/<camelCase>/            domain-agnostic building blocks (index.tsx + styles.module.css), barrel index.ts
    lib/                               http.ts, ws.ts (hub client), jsonPatch.ts, guard.ts, useHub.ts, useRaf.ts, ids.ts
    styles/theme.css                   every token (dark only) and the bundled fonts
  entities/<name>/                     types.ts, schema.ts (runtime guards), api.ts, ui/<component>/, index.ts
  render/                              the WebGL2 engine (pure: render(input) with time passed in)
  routes/<area>/index.tsx              pages compose entity UI
dev/mock-server.mjs                    stand-in backend from contract/fixtures (dev + e2e)
e2e/                                   Playwright specs against the mock
```

## Rules

- HTTP only in `entities/*/api.ts` through `shared/lib/http.ts`; realtime only through `shared/lib/ws.ts`.
- Shared components take generic props, never entity types. Entity UI lives in `entities/<name>/ui`.
- No hex values outside `theme.css` (use `var(--token)`); no `!important`. Red (`--red`) only for on air and the
  playhead. Fonts are local (`public/fonts`); nothing loads from the internet at runtime.
- Edits to a scene are JSON Patch built by `entities/scene/ops.ts` (look up by id so a stale patch can rebase).
  Drags use `editing.setValues(…, 'live' | 'final')`; structural edits use `editing.edit(builder)`.
- The engine never reads clocks or randomness; pass `t` (playhead) and `clock` (ambient seconds).
- Every new shared component gets a demo on `/components`. Copy: active voice, no em dashes, controls say what happens.
- Keep `npm run build`, `npm run typecheck`, `npm test` and `npm run test:e2e` green.
