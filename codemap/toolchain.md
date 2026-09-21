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
  `src/export/encode.ts` alone. `@types/node` is dev-only and exists for the `node:*` imports of
  `tools/make-demo-glb.mjs`. Its version tracks the Node 24 line, matching `engines.node`.
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

`index.html`: one `<canvas id="viewport">`, the mount points `<div id="panels">`, `<div id="timeline">`,
`<div id="hud">`, and `<script type="module" src="/src/app/main.ts">`. `main.ts` resolves the four ids
once and passes the elements to `Panels`, `TimelinePanel`, `Hud`, and the renderer setup.

## Internal logic
N/A — these are declarative configuration files; there is no algorithm here. The only coupling is
one-directional: `tools/make-demo-glb.mjs` (plain JS) is deliberately outside `include`, so `allowJs`
stays off and the script is not typechecked, while `@types/node` still serves its editor support.

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
