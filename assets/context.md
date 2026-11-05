# website/assets/

## Purpose

Static binary resources shipped with the site (fonts, images, audio, icons).
Everything here is copied verbatim to `dist/assets/` by `scripts/deploy.sh`
via `rsync -a website/ dist/`.

## Subfolders

- `fonts/`, typeface files referenced by `@font-face` rules
  - `abysstype*.otf`, used by `abyssbox-*` themes
  - `Varela.ttf`, used by shiggy dialogue bubbles
  - `trebuc.otf`, `raleway.ttf`, `tahoma.otf`, `doomfont.otf`, bundled
    but currently unreferenced (legacy)
  - `google/`, self-hosted Google Fonts (woff2 subsets + declarations).
    See `google/context.md`.
- `images/`, UI icons, theme logos, manual illustrations
- `icons/`, favicons, PWA icons, maskable variants
- `audio/`, preloaded sound assets

## Path convention

All resources are referenced with **paths relative to the referencing HTML
file**. The root site is served at `/`, so `index.html` uses
`./assets/...`, the player at `website/player/index.html` uses
`./../assets/...`, and manual pages under `website/manual/` use
`../assets/...`.
