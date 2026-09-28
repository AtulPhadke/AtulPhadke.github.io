# assets

Static files the site links to. Nothing here is processed; GitHub Pages serves it as-is.

- **Project images**: drop them in `assets/work/` as `<slug>.webp` (for example `mlbroker.webp`, `cap-genie.webp`). Then add an `<img>` inside that card's `<figure class="work-card__media">` in `index.html`. Each figure has a comment with the exact tag. Use 16:10 images, around 1600 × 1000, and give each one real alt text. When a figure contains an `<img>`, the script skips the drawn signature trace.
- **Social preview**: save a 1200 × 630 PNG as `assets/og.png`. The Open Graph and Twitter tags already reference it.
- **Favicon**: `favicon.svg`. Its colours are copied by hand from `tokens.css`, so update both if the palette changes.
