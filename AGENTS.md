# Agent Guide (epub-server)

This repo is a modern, web-based system for importing, managing, and reading EPUB ebooks. It has a Library page and a feature-rich Reader page, backed by a lightweight Flask server.

## Key Entry Points

- `server.py`: Flask backend that serves the UI and book assets and exposes JSON APIs (e.g. `/api/books`, `/api/upload`).
- `index.html` + `js/library.js`: Library UI (browse/import/manage categories).
- `viewer.html` + `js/viewer.js`: Reader SPA (loads chapters via `fetch`, theming, navigation, gestures, annotations).

## PWA (iPhone “No Address Bar”)

- `manifest.webmanifest`: PWA manifest (`display: "standalone"`).
- `js/pwa.js`: registers the Service Worker on secure contexts (`https://` or `localhost`).
- `sw.js`: caches core local assets for quicker loads/offline (on secure contexts).
- `icons/`: app icons (including `apple-touch-icon.png`).

Note: iOS hides the address bar only when launched from a Home Screen icon (Safari → Share → Add to Home Screen). Service Worker/offline caching requires `https://` (or `http://localhost`).

## Repo Layout

```text
/
├── index.html
├── viewer.html
├── manifest.webmanifest
├── sw.js
├── server.py
├── css/
├── js/
│   ├── i18n.js
│   ├── library.js
│   ├── viewer.js
│   └── pwa.js
├── icons/
├── scripts/
├── library/              # runtime data (gitignored)
├── temp_uploads/         # runtime data (gitignored)
└── user_metadata.json    # runtime data (gitignored)
```

## Local Dev

- Use `python3` (the `python` command may not exist).
- Create venv, install deps, run the server:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 server.py
```

Server binds `0.0.0.0:8000` by default.

## Agent Notes / Gotchas

- The UI must be served via HTTP (don’t open `index.html` via `file://`).
- `server.py` relies on relative paths; keep `WorkingDirectory` set if running under systemd.
- Runtime data lives under `library/`, `temp_uploads/`, `user_metadata.json` (all are in `.gitignore`).
- If you change `sw.js` caching behavior, bump `STATIC_CACHE` to invalidate old caches.
