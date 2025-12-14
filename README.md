# EPUB Reader

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

1.  **Install Dependencies (venv)**:
    ```bash
    # Create a virtual environment if you haven't already
    python3 -m venv .venv

    # Activate virtual environment (if not already active)
    source .venv/bin/activate

    # Install dependencies (first run)
    pip install -r requirements.txt
    ```
    If `python3 -m venv .venv` fails because `ensurepip` is unavailable (common on Debian/Ubuntu), install the system venv package (`sudo apt install python3-venv` or the matching version, e.g. `python3.12-venv`), then rerun the `venv` creation step.

2.  **Start the Server**:

    **Option A: systemd Service (recommended)**:

    Create `/etc/systemd/system/epub-server.service` (adjust `User`, `Group`, and paths for your machine):
    ```ini
    [Unit]
    Description=EPUB Flask Server
    After=network.target

    [Service]
    Type=simple
    User=lansy
    Group=lansy
    WorkingDirectory=/home/lansy/epub-server
    Environment=PYTHONUNBUFFERED=1
    ExecStart=/home/lansy/epub-server/.venv/bin/python -u server.py
    Restart=on-failure
    RestartSec=3

    [Install]
    WantedBy=multi-user.target
    ```
    Enable and start it:
    ```bash
    sudo systemctl daemon-reload
    sudo systemctl enable --now epub-server
    sudo systemctl status epub-server

    # Later, after updates
    sudo systemctl restart epub-server

    # View logs
    sudo journalctl -u epub-server -f
    ```
    Note: `WorkingDirectory` is required because `server.py` uses relative paths (e.g. `library/`, `temp_uploads/`).

    **Option B: Run manually (dev)**:
    ```bash
    source .venv/bin/activate
    python3 server.py
    ```

3.  **Open the Library**:
    Navigate to [http://localhost:8000](http://localhost:8000) in your web browser.

4.  **Read**:
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
