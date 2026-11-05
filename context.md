# website/

## Purpose

GitHub Pages deployment source. Static HTML pages, shared stylesheets, and
asset directories. All song data lives in the URL hash; no server-side logic.

## Files

- `index.html`, landing page, hosts `#beepboxEditorContainer` and `#text-content`
- `index_debug.html`, dev-only editor entry (CDN jQuery/select2)
- `common.css`, shared page chrome (html, body, h1, h2, donation, media queries)
- `index.css`, landing page styles (`#beepboxEditorContainer`, `#text-content`, link cards)
- `ancillary.css`, shared chrome for standalone ancillary pages
- `bluesky.css`, Bluesky feed embed page styles
- `sample-extractor.css`, sample extractor utility page styles
- `slarmoosbox-offline-template.css`, offline distributable template styles
- `Bluesky.html`, Bluesky social feed embed
- `macandcheese.html`, easter egg recipe page
- `sample_extractor.html`, soundfont-to-wav utility
- `slarmoosbox_offline_template.html`, offline distributable editor template
- `snake.html`, snake emoji clicker easter egg
- `synth_example.html`, BeepBoxSynth API demo (noindex)

## Subdirectories

- `assets/`, fonts, icons, images
- `manual/`, 10 static reference pages (see `manual/context.md`)
- `offline/`, offline-capable editor build (self-contained, no CDN)
- `player/`, embeddable song player (noindex)
- `samples/`, audio sample bundles

## DOM hooks

- `#beepboxEditorContainer`, editor mount point, consumed read-only by `editor/main.ts`
- `#text-content`, description panel, consumed read-only by `editor/renderers/render-layout.ts`

## Deployment

`bun run deploy` builds bundles to `dist/`, rsyncs `website/` into `dist/`,
pushes `dist/` to `gh-pages`. Static HTML deploys as-is.
