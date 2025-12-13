# Project Context & Developer Guide

This project provides a modern, web-based system for managing and reading unpacked EPUB ebooks. It features a central Library view, a feature-rich Modern Reader, and legacy support for standalone book viewing.

## Core Components

### 1. Web Interface
-   **Library (`index.html`)**: The entry point. Lists configured books and links to the Modern Reader.
-   **Modern Reader (`viewer.html` + `js/viewer.js`)**: A single-page application that dynamically loads book content (chapters) via fetch. It handles TOC parsing, theming (Dark/Sepia), font sizing, and navigation.
-   **Legacy Reader (`[Book]/index.html`)**: An older, self-contained reader residing in each book's directory. It is maintained for backward compatibility and direct folder access.

### 2. Scripts (`scripts/`)
Python scripts are used to process the raw HTML files extracted from EPUBs.
-   `process_ebook.py`: The main utility.
    -   **Sanitization**: Removes `<a>` tags from titles to prevent accidental clicks during reading.
    -   **Navigation Injection**: Injects a script into every HTML chapter file. This script detects if the file is loaded directly (top-level) and redirects the user to the Legacy Reader frame (`[Book]/index.html`) with the correct chapter hash.
-   `convert.sh`: specific shell script to install dependencies (`beautifulsoup4`, `lxml`) and run `process_ebook.py` on the current book collection.

## Directory Structure

```text
/
├── index.html            # Main Library
├── viewer.html           # Modern Reader App
├── js/
│   ├── library.js        # Library configuration & rendering
│   └── viewer.js         # Modern Reader logic (TOC, fetch, UI)
├── css/                  # Shared styles
├── scripts/
│   ├── convert.sh        # Build/Process script
│   └── process_ebook.py  # Content processing logic
└── [Book_Directory]/     # Unpacked EPUB content
    ├── index.html        # Legacy Reader entry point
    ├── OPS/              # OEBPS standard folder (content)
    └── ...
```

## Setup & Workflow

1.  **View**: Start the backend server (`python3 server.py`) and visit `localhost:8000`.
2.  **Add Book**: Use the "Import" button in the Web UI to upload an EPUB file. The server will automatically unzip, process, and add it to the library.
3.  **Manual Processing**: (Optional) Scripts in `scripts/` are still available for manual maintenance.

## Development Notes

-   **Client-Side Only**: The project is designed to run without a dynamic backend. It relies on standard browser APIs (`fetch`, `DOMParser`).
-   **CORS**: Because `viewer.js` uses `fetch` to load local files, it requires a local web server. Opening `index.html` via `file://` protocol will likely fail due to CORS policies.
-   **Han Unification**: The Modern Reader attempts to detect the document language to apply correct font stacks for Japanese/Chinese character variants.