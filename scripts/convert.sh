#!/bin/bash
# This script installs dependencies and processes the specified ebook directories.

# Exit immediately if a command exits with a non-zero status.
set -e

# Install required python packages
pip install beautifulsoup4 lxml

# Get the script's directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
# PROJECT_ROOT="$SCRIPT_DIR/.." # Unused now if we rely on CWD or relative paths

# Run the processing script (defaults to scanning 'library/' if no args provided)
# We assume the script is run from project root, or process_ebook handles relative 'library' path
# process_ebook.py now looks for 'library' or '../library'.
python3 "$SCRIPT_DIR/process_ebook.py"

echo "Ebook processing complete."
