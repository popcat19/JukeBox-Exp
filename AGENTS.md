# AGENTS.md

## Project overview

Browser-based tool for sketching and sharing instrumental music.
Fork of JukeBox_TypeScript, Ultrabox, JummBox, and BeepBox.

Song data is encoded in the URL hash. Copy the URL to save and share.

Read `README.md` for the human-facing overview.
Read root `context.md` for root-level file and directory details.

## Project structure

Four bounded contexts:

|Directory|Purpose|
|---|---|
|`editor/`|Song editor UI|
|`synth/`|Standalone audio engine|
|`player/`|Embeddable miniature player|
|`shared/`|Shared kernel for themes, events, color, spectrum, and PMD|

Supporting directories:

- `scripts/` for build and dev tooling
- `tests/` for `bun:test`
- `docs/` and `concepts/` for project documentation
- `conventions/` for development rules
- `readme_manifest/` for README sources
- `community_modules/` for reference instrument modules
- `tools/` for utilities
- `website/` for GitHub Pages source assets
- `dist/` for ignored build output

Per-directory details live in each directory's `context.md`.
Read that file before making file-level structural decisions.
It is the source of truth.

## Setup commands

```bash
bun install
bun run dev              # watch with SharedArrayBuffer support
bun run dev:static       # watch without the worklet bundle
bun run dev:legacy       # watch without COOP/COEP headers or worklet bundle
bun run build            # production build → dist/
bun run build:offline    # offline-capable build
```

## Testing and quality

```bash
bun test                  # all tests
bun test --filter "name"  # subset by test name
bun run typecheck:all     # editor, synth, player, and worklet
bun run lint              # Biome, three TypeScript projects, and ESLint
bun run lint:fix          # auto-fix formatting
```

Before every commit: `bun test && bun run typecheck:all`.

Test conventions and the source-to-test map live in `tests/TESTING.md`.

## Debug tools

Browser console on a dev build:

```js
__jukebox__.validate()               // Cross-type contamination, stale refs
__jukebox__.record.start()/stop()    // Capture ops, dump replay script
__jukebox__.replay(ops)              // Deterministic restore, navigation, and paste
__jukebox__.audio()                  // Worklet underrun recovery counter
```

## TypeScript projects

Four configs extend `tsconfig.base.json`:

- `tsconfig_editor.json` for `editor/`
- `tsconfig_synth.json` for `synth/`
- `tsconfig_player.json` for `player/`
- `tsconfig_worklet.json` for `synth/render/` worklet files

Typecheck each affected project before cross-project changes.
`bun run typecheck:all` runs all four.

## Code style

- TypeScript uses strict compiler options, including `noImplicitAny`.
- Biome and ESLint format and lint source code.
- Follow dev-mini conventions in `conventions/DEVELOPMENT.md`.
- Module headers carry `Purpose:` lines.
- `context.md` entries derive from module headers.
- Directories with five or more non-obvious files need a `context.md`.

## README workflow

Edit `readme_manifest/*.md`, then run `bash tools/generate-readme.sh`.

## Labels

Colors from pmd.hue.245. P0 (salmon) to P4 (muted).
Context labels tag the area: refactor, css, dom, html, shared, themes, editor, player, website, test.
Every issue gets a P label. Body is grug style.

## Forgejo

Repo: `popcat19/JukeBox-Exp`. Branch: `dev-exp` only. No feature branches.
No project API in forgejo 15.0.3. Board at project/6 needs manual moves.
`fj -H dawn.wine` for CLI. Label/milestone writes use curl + api.

## Milestone #5

Tree-wide css/dom/html restruct. 8 issues (#23-#30).
Order: #23 (audit) → #24 (inject) → #25 (tokens).

# 30 (guards) lands before #26-#29 migrations

Docs in `concepts/css_dom_html_restruct/`.

## Deployment

```bash
bun run deploy       # full deployment
bun run deploy-files # assemble deployment assets in to_deploy/
```

## Guarded files

- Edit `readme_manifest/*.md` only through the README manifest workflow.
- Do not revise `conventions/DEVELOPMENT.md`, `conventions/DEV-EXAMPLES.md`,
  `conventions/SKILL.md`, `conventions/src/changelog.sh`, or
  `conventions/src/sync.sh` without an explicit user request.
