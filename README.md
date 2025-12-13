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
-   **Legacy/Standalone Reader**: Each book also retains a standalone `index.html` reader for individual access (supported by processing scripts).

## Getting Started

1.  **Start the Server**:
    We now use a custom Python server to handle library management and imports.
    ```bash
    # Activate virtual environment (if not already active)
    source .venv/bin/activate
    
    # Run the server
    python3 server.py
    ```
    *Note: This replaces the old `python3 -m http.server` command.*

2.  **Open the Library**:
    Navigate to [http://localhost:8000](http://localhost:8000) in your web browser.

3.  **Read**:
    Click on a book cover to open the Modern Reader.

## Project Structure

-   `index.html`: The main Library entry point.
-   `viewer.html`: The modern, universal reader application.
-   `css/` & `js/`: Shared styles and logic.
-   `scripts/`: Python utilities for maintaining ebook files.
    -   `process_ebook.py`: Cleans HTML titles and injects redirects for the legacy reader.
    -   `convert.sh`: Helper script to run processing.
-   `[BookFolder]/`: Unpacked EPUB directories.
    -   Contains a legacy `index.html` reader.

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
3.  (Optional) Run `scripts/convert.sh` to clean up the HTML and enable the legacy reader for the new book.

## Scripts & content processing

The `scripts/` directory contains tools to manage the HTML content.

-   **`process_ebook.py`**:
    1.  **Clean Titles**: Removes hyperlinks from `<p>` tags in titles (common in some converted EPUBs).
    2.  **Inject Redirects**: Adds a Javascript snippet to chapter files. If you open a chapter HTML file directly (e.g., `Book/OPS/xhtml/001.html`), it redirects you to the book's standalone reader (`Book/index.html`).

Usage:
```bash
./scripts/convert.sh
```