# Project Context & Developer Guide

This project provides a modern, web-based system for importing, managing, and reading EPUB ebooks. It features a central Library view and a feature-rich Modern Reader, backed by a lightweight Python server.

## Core Components

### 1. Web Interface
-   **Library (`index.html` + `js/library.js`)**: The entry point. Lists server-managed books and links to the Modern Reader. Also supports importing EPUBs and managing categories.
-   **Modern Reader (`viewer.html` + `js/viewer.js`)**: A single-page application that loads book content (chapters) via `fetch`. It handles TOC parsing, theming (Dark/Sepia), font sizing, navigation, and touch gestures (swipe to change chapters).

### 2. Server
-   **Flask backend (`server.py`)**: Serves the UI and book assets, and exposes a small JSON API (e.g. `/api/books`) used by the Library UI. It also handles EPUB upload/unzip and basic content processing.

### 3. Scripts (`scripts/`)
Python scripts are used to process the raw HTML files extracted from EPUBs.
-   `process_ebook.py`: The main utility.
    -   **Sanitization**: Removes `<a>` tags from titles to prevent accidental clicks during reading.
-   `convert.sh`: specific shell script to install dependencies (`beautifulsoup4`, `lxml`) and run `process_ebook.py` on the current book collection.

## Directory Structure

```text
/
├── index.html            # Main Library
├── viewer.html           # Modern Reader App
├── server.py             # Flask server (API + static + book serving)
├── js/
│   ├── library.js        # Library configuration & rendering
│   └── viewer.js         # Modern Reader logic (TOC, fetch, UI)
├── css/                  # Shared styles
├── library/              # Imported & unpacked EPUB directories
├── temp_uploads/         # Temporary upload workspace
├── user_metadata.json    # Categories and other user metadata
├── scripts/
│   ├── convert.sh        # Build/Process script
│   └── process_ebook.py  # Content processing logic
```

## Setup & Workflow

1.  **View**: Start the backend server (`python3 server.py`) and visit `localhost:8000`.
2.  **Add Book**: Use the "Import" button in the Web UI to upload an EPUB file. The server will automatically unzip, process, and add it to the library.
3.  **Manual Processing**: (Optional) Scripts in `scripts/` are still available for manual maintenance.

## Development Notes

-   **Server-backed**: The UI depends on `server.py` for the book list, imports, and serving book assets. Opening `index.html` via `file://` will not work reliably.
-   **CORS**: Because `viewer.js` uses `fetch` to load local files, it requires a local web server. Opening `index.html` via `file://` protocol will likely fail due to CORS policies.
-   **Han Unification**: The Modern Reader attempts to detect the document language to apply correct font stacks for Japanese/Chinese character variants.
