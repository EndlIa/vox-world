# toolchain: package.json · tsconfig.json · vite.config.ts · vitest.config.ts · index.html

Ring: 4 (composition) · Layer: toolchain · Depends on: none — these files depend on no module under `src/`, and no `src/` module may read them

## Responsibility
The five root files that make the repository installable, typecheckable, testable, buildable, and
loadable. They configure the toolchain only: no project behavior lives here. Versions, compiler
options, test environment, and DOM mount points are pinned so every other contract can rely on them.

## Public interface
`package.json`:
```json
{
  "name": "vox-world",
  "private": true,
  "type": "module",
  "engines": { "node": "24.21.0" },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "check": "npm run typecheck && npm test"
  },
  "dependencies": { "three": "0.186.0", "mp4-muxer": "5.2.2" },
  "devDependencies": {
    "@types/three": "0.186.0",
    "@types/node": "24.13.6",
    "typescript": "7.0.2",
    "vite": "8.3.0",
    "vitest": "5.0.1"
  }
}
```
- Every version is exact — no caret, no range (README section 3).
- `three@0.186.0` and `@types/three@0.186.0` move together; `@types/three` is required because `three`
  ships no types. `mp4-muxer` is the only runtime dependency besides `three`, used by
  `src/export/encode.ts` alone. `@types/node` is dev-only: it is kept pinned with the rest of the
  toolchain, but no checked file imports a `node:*` module any more — the build-time demo-asset
  generator that used `node:fs` and `node:path` was removed, and `tsconfig.include` covers only
  `src`, `tests`, `vite.config.ts`, and `vitest.config.ts`. Its version tracks the Node 24 line,
  matching `engines.node`.
- Node `24.21.0` matches README section 3's row and satisfies `vite@8` and `vitest@5`.

`tsconfig.json`: `target: "ES2022"`, `lib: ["ES2022", "DOM"]`, `module: "ESNext"`,
`moduleResolution: "bundler"`, `strict: true`, `noUncheckedIndexedAccess: true`,
`exactOptionalPropertyTypes: true`, `noEmit: true`, `isolatedModules: true`, `skipLibCheck: true`,
`include: ["src", "tests", "vite.config.ts", "vitest.config.ts"]`, plus four flags that were added
when the file was written and are part of the contract from now on: `noImplicitOverride: true`,
`noFallthroughCasesInSwitch: true`, `verbatimModuleSyntax: true` (so every type-only import must be
written `import type`), and `types: ["node"]`. These are strictly tightening: they cannot change
runtime behavior, they only reject code the contracts already required to be explicit.

`vite.config.ts`: `defineConfig` from `vite` with a single option, `build: { target: 'es2022' }` — the
repository root is the Vite root (`index.html` sits beside the config), and no plugins, aliases, or
`base` override exist.

`vitest.config.ts`: `defineConfig` from `vitest/config` with `test: { environment: 'node',
include: ['tests/**/*.test.ts'], globals: false }`, so tests import `describe`/`it`/`expect` from
`vitest` and never see a DOM.

`index.html`: one `<canvas id="viewport">`, the mount points `<div id="panels">`, `<div id="timeline" hidden>`,
`<div id="hud">`, `<div id="modebar">`, and `<script type="module" src="/src/app/main.ts">`. `main.ts` resolves the four ids
once and passes the elements to `Panels`, `TimelinePanel`, `Hud`, and the renderer setup. The timeline bar carries `hidden`
in the markup because it starts collapsed — the rail's `Animation` button is the only thing that shows it — and the attribute
is here rather than set by the module so the bar cannot flash while the bundle loads (README D44). For the same decision
`#viewport` carries `min-height: 0`: a canvas' intrinsic size comes from its drawing-buffer attributes, and a grid item's
automatic minimum would floor the row with it, which pushes the `auto` timeline row past the bottom of the `100vh` column
where `body { overflow: hidden }` clips it away — the bar would exist and be unreachable (README D44). The `:root`
declaration `--scene` and the `html`/`body`/`#viewport` backgrounds use it, so nothing darker shows
behind or beside the canvas; the value must equal `DEFAULT_BACKGROUND` in `src/document/project.ts`,
which is the definition the 3D scene and the exported frames actually use. The stylesheet also owns the
pieces of chrome the panel overlay is built from, because they are layout rather than state: `#panels` is an absolutely
positioned 112 px box at the top-left of the window which takes no space from `#viewport` — that is what keeps the canvas at
the full window width — and it is `pointer-events: none` with `pointer-events: auto` on its children, so only the rail
buttons and the status boxes take a press and the rest reaches the canvas; `.rail` is ordered first inside it, which is what
puts the buttons above the status line `main.ts` appended before the panel existed; and `.window` is the fixed-position
floating window (`z-index: 15`, above `#hud` at 10 and below the voxelize modal at 20) with a draggable title bar and a
scrolling body whose `hr` is drawn as a `--line` rule, which is how a group divides what acts on every object from what
acts on the selected one; `#modebar` is the one mount point that is a grid item of the canvas' own area rather than an
absolutely positioned overlay, pinned to that area's bottom centre (`justify-self: center`, `align-self: end`) and sized to its
buttons, so it sits over the viewport's bottom edge whatever the timeline's height is, between the HUD's `z-index` and the rail's.
`button:disabled`, `select:disabled`, and `input:disabled` drop to `--dim` and are dimmed whole, because every control sets its own
`color` and a disabled one would otherwise look live.

## Internal logic
N/A — these are declarative configuration files; there is no algorithm here. Nothing sits outside
`include` any more: `src`, `tests`, `vite.config.ts`, and `vitest.config.ts` are the whole checked
surface, `allowJs` stays off, and everything in it is TypeScript.

## Invariants
- No dependency version carries a caret or range; the six pinned versions equal README section 3.
- `type` is `"module"`, and every source file is ESM with `.js` extensions in relative imports.
- `check` runs `typecheck` and then `test`, and nothing else (README D16).
- No linter or formatter is configured in this slice: no `eslint`, `prettier`, `biome`, or config file
  for them exists, and no script pretends to run one.
- Typechecking and tests are GPU-free and DOM-free; only `index.html` plus the ring-2/4 runtime modules
  touch the DOM.
- `vitest` collects exactly `tests/**/*.test.ts`; no test file lives elsewhere.

## Errors
- None at runtime: these files are static configuration. Misconfiguration surfaces as a failing
  command — a caret range or a wrong version fails `npm install`, a missing `include` entry drops files
  from `npm run typecheck`, and a wrong `include` pattern makes `npm test` report no test files.

## Dependencies
`vite` (config and CLI), `vitest/config`, `typescript`, `@types/three`, `@types/node`, and the page's
import of `src/app/main.ts`. No module under `src/` imports any of these files.

## Tests
No unit test pins them. They are verified by `npm run check` (typecheck plus tests, D16), by
`npm run build` producing the bundle from `index.html`, and by `npm run dev` loading the page and
mounting panels, timeline, and HUD into the four elements above.

## Open questions
- `@types/node` is now pinned at `24.13.6`, recorded above.
- `mp4-muxer@5.2.2` prints a deprecation notice at install time recommending Mediabunny, its successor.
  The pinned choice stands for this slice: the API difference is confined to `src/export/encode.ts`
  behind the `FrameSink` port, so migrating later rewrites one file and no caller.
- README pins no `build.target` value; `es2022` is chosen to match `tsconfig.target` rather than to
  support an older browser.
