# Gemini Reader

A modern, web-based EPUB reader for unpacked ebooks.

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
-   `css/` & `js/`: Shared styles and logic.
-   `scripts/`: Python utilities for maintaining ebook files.
    -   `process_ebook.py`: Cleans HTML titles to remove stray hyperlinks.
    -   `convert.sh`: Helper script to run processing.
-   `[BookFolder]/`: Unpacked EPUB directories.

## Adding New Books

1.  Unpack your EPUB into a new folder in this directory.
2.  Open `js/library.js` and add a new entry to the `books` array:
    ```javascript
    {
        title: "Book Title",
        author: "Author Name",
        dir: "FolderName",
        cover: "FolderName/path/to/cover.jpg"
    }
    ```
3.  (Optional) Run `scripts/convert.sh` to clean up the HTML if the source EPUB needs fixes.

## Scripts & content processing

The `scripts/` directory contains tools to manage the HTML content.

-   **`process_ebook.py`**:
    1.  **Clean Titles**: Removes hyperlinks from `<p>` tags in titles (common in some converted EPUBs).

Usage:
```bash
./scripts/convert.sh
```
