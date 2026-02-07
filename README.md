# Graphy

Static web app (no framework build) for editing image-based graphs and exporting JSON/PNG overlays.

## Local dev

1. Install deps:

```bash
npm ci
```

2. Run smoke tests:

```bash
npm test
```

3. Serve locally (any static server works), for example:

```bash
python3 -m http.server 5173 -d public
```

Then open `http://localhost:5173/`.

## Build

Creates a deployable static output in `dist/`:

```bash
npm run build
```

## Deploy (GitHub Pages)

This repo deploys via GitHub Actions to GitHub Pages on push to `main`.

1. In GitHub: `Settings -> Pages -> Build and deployment -> Source: GitHub Actions`.
2. Push to `main` (or run the workflow manually).

Notes:
- Asset/service-worker/manifest paths are relative so the app works when served from `/<repo>/` on GitHub Pages.

