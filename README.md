# BOOTEI

Sito cinematografico per **Bootei** — sabot Made in Italy. La hero è un video
controllato dallo scroll (scroll-driven scrubbing) costruito secondo il
`CINEMATIC-SCROLL-PLAYBOOK.md`.

> *Your life, your rules.*

## Struttura

```
site/
├── index.html        # markup (hero track/stage + sezioni)
├── styles.css        # palette Bootei, font, layout
├── main.js           # scroll → currentTime, seek serializzato, canvas, reveal
└── public/
    ├── hero-motion.mp4   # H.264 yuv420p, keyframe per frame, faststart
    └── hero-poster.jpg
```

## Sviluppo locale

```bash
cd site
python -m http.server 8123
# apri http://localhost:8123/
```

## Deploy (Cloudflare Pages)

- Build command: *(nessuno — sito statico)*
- Build output directory: `site`

## Tecnica

- Una sola fonte di verità per il tempo del video: il progresso dello scroll.
- Un solo seek in volo, nessun easing su `currentTime`.
- Firefox usa il video nativo; Chromium/Safari possono usare il canvas.
- `prefers-reduced-motion` riduce le decorazioni, non rompe lo scrub.
