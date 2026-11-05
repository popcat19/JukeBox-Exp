# website/assets/fonts/google/

## Purpose

Self-hosted Google Fonts woff2 declarations and subset files for offline use.
Replaces runtime fetches to `fonts.googleapis.com` / `fonts.gstatic.com` so the
site renders correctly with no network access.

## Files

- `fonts.css`, `@font-face` rules for Fredoka, Fira Code, Roboto, B612.
  Each rule carries its own `unicode-range`, so the browser only fetches the
  subset it needs. Subset filenames follow the `*.<subset>.woff2` convention
  and stay stable across re-vendoring.
- `fredoka/{hebrew,latin-ext,latin}.woff2`, variable font covering weights
  500–700 (single file, three subsets).
- `fira_code/{cyrillic-ext,cyrillic,greek-ext,greek,symbols2,latin-ext,latin}.woff2`
 , weight 400, monospace.
- `roboto/{cyrillic-ext,cyrillic,greek-ext,greek,math,symbols,vietnamese,latin-ext,latin}.woff2`
 , weight 400, used by the standalone player page.
- `b612/latin.woff2`, Latin-only, lifted from the existing offline bundle
  (was `website/offline/3JnySDDxiSz36j6yGQ.woff2`).

## Vendoring workflow

Subset URLs rotate as Google reissues the fonts. To re-vendor:

1. Fetch the CSS with a Chrome UA so Google serves woff2:
   ```bash
   curl -sSfL -A "Mozilla/5.0 Chrome/120.0" \
     "https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Fira+Code:wght@400&display=swap"
   ```
2. Extract the `https://fonts.gstatic.com/...woff2` URLs and download with
   the same UA.
3. Update `fonts.css` if subset filenames or unicode-ranges changed.

## Usage in HTML

```html
<link rel="stylesheet" href="./assets/fonts/google/fonts.css" />
```

Consumers `font-family`-reference `'Fredoka'`, `'Fira Code'`, `'Roboto'`,
`'B612'` exactly as before. The CDN `<link>` tags in editor pages are
removed; the local CSS is the single source of truth.

## Caveats

- We only vendor Latin-ish subsets (no CJK, no Arabic etc). Visitors using
  characters outside the declared ranges fall back to the next family in the
  `font-family` stack (e.g. `Rounded Mplus 1c`, `sans-serif`).
- New weights/styles require re-vendoring; there is no automatic
  fetching at build time.
