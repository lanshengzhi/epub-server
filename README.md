# Gemini Reader

A modern, web-based EPUB reader with a lightweight Python server backend.

## Features

-   **Library View**: Visual bookshelf interface to browse your collection.
-   **Modern Reader**:
    -   Distraction-free reading interface.
    -   Dark Mode & Sepia Mode support.
    -   Font size and margin adjustment.
    -   Collapsible Table of Contents (TOC).
    -   Progress saving (remembers your last read page).

## Getting Started

1.  **Start the Server**:
    We now use a custom Python server to handle library management and imports.
    ```bash
    # Create a virtual environment if you haven't already
    python3 -m venv .venv

    # Activate virtual environment (if not already active)
    source .venv/bin/activate

    # Install dependencies (first run)
    pip install -r requirements.txt

    # Run the server
    python3 server.py
    ```
    If `python3 -m venv .venv` fails because `ensurepip` is unavailable (common on Debian/Ubuntu), install the system venv package (`sudo apt install python3-venv` or the matching version, e.g. `python3.12-venv`), then rerun the `venv` creation step.

2.  **Open the Library**:
    Navigate to [http://localhost:8000](http://localhost:8000) in your web browser.

3.  **Read**:
    Click on a book cover to open the Modern Reader.

## Project Structure

-   `index.html`: The main Library entry point.
-   `viewer.html`: The modern, universal reader application.
-   `server.py`: Flask server (API + static + book file serving).
-   `css/` & `js/`: Shared styles and logic.
-   `library/`: Imported & unpacked EPUB book directories (managed by the server).
-   `temp_uploads/`: Temporary upload workspace.
-   `user_metadata.json`: Per-book user metadata (e.g. categories).
-   `scripts/`: Python utilities for maintaining ebook files.
    -   `process_ebook.py`: Cleans HTML titles to remove stray hyperlinks.
    -   `convert.sh`: Helper script to run processing.

## Adding New Books

Use the **Import** button in the web UI. The server will upload, unzip, process, and add the book under `library/`.

## Scripts & content processing

The `scripts/` directory contains tools to manage the HTML content.

-   **`process_ebook.py`**:
    1.  **Clean Titles**: Removes hyperlinks from `<p>` tags in titles (common in some converted EPUBs).

Usage:
```bash
./scripts/convert.sh
```
