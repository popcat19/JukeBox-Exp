# Root Context

Purpose: Project root with configuration, build tooling, and entry points.

## Root Files

- `index.html`, Main editor HTML entry point loaded by the dev server
- `404.html`, Custom 404 page for GitHub Pages
- `service_worker.js`, Offline caching service worker for production builds
- `AGENTS.md`, Reference document for LLM assistants working with this repository
- `README.md`, Project overview and user-facing documentation
- `LICENSE.md`, MIT license file
- `UPSTREAM-MAPPING.md`, Mapping from upstream BeepBox source to local module locations
- `bun.lock`, Bun package lockfile
- `bun.lockb`, Bun binary lockfile
- `package.json`, Node.js package manifest with scripts and dependencies
- `package-lock.json`, npm lockfile for CI environments
- `biome.json`, Biome formatter and linter configuration
- `eslint.config.mjs`, ESLint configuration with TypeScript rules
- `import-boundaries-baseline.json`, Reviewed forbidden-import exceptions and import-cycle size ceilings
- `flake.nix`, Nix flake definition for reproducible development environments
- `flake.lock`, Nix flake lockfile
- `tsconfig.json`, Root TypeScript config forwarding to sub-projects
- `tsconfig.base.json`, Shared TypeScript compiler options for all sub-projects
- `tsconfig_editor.json`, TypeScript config for the editor project
- `tsconfig_synth.json`, TypeScript config for the synth project
- `tsconfig_player.json`, TypeScript config for the player project
- `.gitignore`, Git ignore rules
- `.rgignore`, Ripgrep ignore rules

## Subdirectories

- `editor/`, Main editor UI and logic application
- `synth/`, Audio synthesis engine
- `player/`, Standalone song player embed
- `shared/`, Shared kernel (themes, events, color utilities, spectrum analyzer, PMD adapter)
- `scripts/`, Build, deploy, lint, and dev server tooling
- `tests/`, bun:test test files
- `docs/`, Architecture refactors and audit documentation
- `concepts/`, Design concept documents
- `conventions/`, Reference copy of dev-mini conventions
- `readme_manifest/`, Modular README source files
- `community_modules/`, Reference community InstrumentModules outside the core tree
- `tools/`, Utility scripts (generate-readme.sh)
- `website/`, GitHub Pages deployment source (static assets, manual pages, offline bundle)
