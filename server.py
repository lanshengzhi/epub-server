import os
import shutil
import zipfile
import re
import uuid
import glob
import json
import threading
import time
from urllib.parse import unquote
from flask import Flask, request, jsonify, send_from_directory
from bs4 import BeautifulSoup

app = Flask(__name__)

UPLOAD_FOLDER = 'temp_uploads'
LIBRARY_FOLDER = 'library'
USER_METADATA_FILE = 'user_metadata.json'
IGNORE_DIRS = {'.git', '.venv', 'css', 'js', 'scripts', 'temp_uploads', '__pycache__', 'library'}

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

if not os.path.exists(LIBRARY_FOLDER):
    os.makedirs(LIBRARY_FOLDER)

# --- Upload Task Tracking (for progress / logs) ---
UPLOAD_TASKS = {}
UPLOAD_TASKS_LOCK = threading.Lock()
UPLOAD_TASK_TTL_SECONDS = 60 * 60  # 1 hour

def _prune_upload_tasks():
    now = time.time()
    with UPLOAD_TASKS_LOCK:
        expired = [k for k, v in UPLOAD_TASKS.items() if now - v.get('created_at', now) > UPLOAD_TASK_TTL_SECONDS]
        for k in expired:
            UPLOAD_TASKS.pop(k, None)

def _task_append_log(task_id, message):
    print(message)
    with UPLOAD_TASKS_LOCK:
        task = UPLOAD_TASKS.get(task_id)
        if not task:
            return
        task['logs'].append(message)
        task['updated_at'] = time.time()

def _task_update(task_id, **fields):
    with UPLOAD_TASKS_LOCK:
        task = UPLOAD_TASKS.get(task_id)
        if not task:
            return
        task.update(fields)
        task['updated_at'] = time.time()

def _process_upload_task(task_id, filepath, filename, categories):
    extract_path = None
    try:
        class TaskLogs:
            def __init__(self, task_id):
                self._task_id = task_id
            def append(self, message):
                with UPLOAD_TASKS_LOCK:
                    task = UPLOAD_TASKS.get(self._task_id)
                    if not task:
                        return
                    task['logs'].append(message)
                    task['updated_at'] = time.time()

        task_logs = TaskLogs(task_id)

        _task_update(task_id, status='running', progress={'phase': 'received', 'current': 0, 'total': 0})
        _task_append_log(task_id, f"File uploaded: {filename}")

        # 1. Unzip
        book_name_safe = os.path.splitext(filename)[0]
        book_name_safe = re.sub(r'[^\w\-\u4e00-\u9fa5]', '_', book_name_safe)
        extract_path = os.path.join(LIBRARY_FOLDER, book_name_safe)

        # Handle collision
        if os.path.exists(extract_path):
            extract_path += "_" + str(uuid.uuid4())[:8]

        _task_update(task_id, progress={'phase': 'extracting', 'current': 0, 'total': 0})
        _task_append_log(task_id, f"Extracting to: {extract_path}")

        with zipfile.ZipFile(filepath, 'r') as zip_ref:
            zip_ref.extractall(extract_path)

        _task_append_log(task_id, "Extraction complete.")

        # 2. Process Files
        # Collect files to process so we can provide progress.
        files_to_process = []
        for root, dirs, files in os.walk(extract_path):
            for file in files:
                if file.lower().endswith(('.css', '.html', '.xhtml')):
                    files_to_process.append(os.path.join(root, file))

        total = len(files_to_process)
        processed = 0
        _task_update(task_id, progress={'phase': 'processing', 'current': processed, 'total': total})
        _task_append_log(task_id, f"Processing files: {total}")

        for full_path in files_to_process:
            name = os.path.basename(full_path)
            lower = name.lower()

            if lower.endswith('.css'):
                convert_css_vertical_to_horizontal(full_path, task_logs)

            if lower.endswith(('.html', '.xhtml')):
                convert_css_vertical_to_horizontal(full_path, task_logs)
                process_html_content(full_path, task_logs)

            processed += 1
            if processed == total or processed % 10 == 0:
                _task_update(task_id, progress={'phase': 'processing', 'current': processed, 'total': total})

        _task_append_log(task_id, "Content processing complete.")

        # Cleanup Upload
        try:
            os.remove(filepath)
        except Exception:
            pass

        # 3. Save Metadata (Categories) if provided
        _task_update(task_id, progress={'phase': 'finalizing', 'current': processed, 'total': total})
        if categories:
            user_meta = load_user_metadata()
            book_dir_name = os.path.basename(extract_path)
            if book_dir_name not in user_meta:
                user_meta[book_dir_name] = {}

            current_cats = user_meta[book_dir_name].get('categories', [])
            for cat in categories:
                cat = (cat or '').strip()
                if cat and cat not in current_cats:
                    current_cats.append(cat)

            user_meta[book_dir_name]['categories'] = current_cats
            save_user_metadata(user_meta)
            _task_append_log(task_id, f"Added categories: {', '.join(categories)}")

        book_dir_name = os.path.basename(extract_path)
        _task_update(
            task_id,
            status='done',
            book_dir=book_dir_name,
            progress={'phase': 'done', 'current': total, 'total': total},
        )
        _task_append_log(task_id, "Import finished.")

    except Exception as e:
        _task_append_log(task_id, f"Error processing: {e}")
        _task_update(task_id, status='error', error=str(e), progress={'phase': 'error', 'current': 0, 'total': 0})
        try:
            if filepath and os.path.exists(filepath):
                os.remove(filepath)
        except Exception:
            pass

# --- Helper Functions ---

def log(logs, message):
    print(message)
    logs.append(message)

def get_script_to_inject():
    return """
    if (window.top === window.self) { // Only run if not in an iframe
        var path = window.location.pathname;
        var opsIndex = path.indexOf('/OPS/');
        if (opsIndex === -1) {
             opsIndex = path.indexOf('/OEBPS/');
        }
        if (opsIndex !== -1) {
            var bookRootRelative = path.substring(0, opsIndex);
            // Adjust substring start based on which folder was found (length of /OPS/ is 5, /OEBPS/ is 7)
            // Actually, we found the START index of the string.
            // if we found /OPS/, we want to skip 5 chars.
            // if we found /OEBPS/, we want to skip 7 chars.
            var matchStr = path.indexOf('/OPS/') !== -1 ? '/OPS/' : '/OEBPS/';
            var chapterPath = path.substring(opsIndex + matchStr.length);
            window.location.replace(bookRootRelative + '/index.html#' + chapterPath);
        }
    }
"""

def process_html_content(filepath, logs):
    """
    Cleans titles and injects navigation script.
    Same logic as scripts/process_ebook.py
    """
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        soup = BeautifulSoup(content, 'lxml')
        modified = False

        # 1. Clean Titles (remove <a> in <p>)
        for p_tag in soup.find_all('p'):
            links = p_tag.find_all('a')
            if links:
                for a_tag in links:
                    a_tag.unwrap()
                modified = True
                
        # 2. Inject Script
        head = soup.find('head')
        if head:
            if "window.location.replace" not in str(head):
                script_tag = soup.new_tag("script")
                script_tag.string = get_script_to_inject()
                head.append(script_tag)
                modified = True
        
        if modified:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(str(soup))
            # log(logs, f"Processed HTML: {os.path.basename(filepath)}")
            
    except Exception as e:
        log(logs, f"Error processing HTML {filepath}: {e}")

def convert_css_vertical_to_horizontal(filepath, logs):
    """
    Reads a CSS (or HTML) file and replaces vertical writing mode with horizontal.
    """
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        # Regex patterns for vertical writing modes
        # Matches: writing-mode: vertical-rl; or -webkit-writing-mode: vertical-rl;
        # We replace them with horizontal-tb
        
        new_content = content
        
        patterns = [
            (r'(writing-mode\s*:\s*)vertical-rl', r'\1horizontal-tb'),
            (r'(-webkit-writing-mode\s*:\s*)vertical-rl', r'\1horizontal-tb'),
            (r'(writing-mode\s*:\s*)vertical-lr', r'\1horizontal-tb'),
            (r'(-webkit-writing-mode\s*:\s*)vertical-lr', r'\1horizontal-tb'),
        ]

        changes = 0
        for pattern, replacement in patterns:
            new_content, n = re.subn(pattern, replacement, new_content, flags=re.IGNORECASE)
            changes += n

        if changes > 0:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(new_content)
            log(logs, f"Converted {changes} vertical styles in: {os.path.basename(filepath)}")

    except Exception as e:
        log(logs, f"Error converting CSS {filepath}: {e}")

def get_book_metadata(book_dir_name):
    """
    Attempts to extract metadata from .opf file.
    Returns dict: {title, author, cover_path}
    """
    book_dir = os.path.join(LIBRARY_FOLDER, book_dir_name)
    opf_files = glob.glob(os.path.join(book_dir, '**', '*.opf'), recursive=True)
    if not opf_files:
        # print(f"No OPF found in {book_dir}")
        return None
    
    opf_path = opf_files[0]
    
    try:
        book_root_real = os.path.realpath(book_dir)

        with open(opf_path, 'r', encoding='utf-8') as f:
            # parsing as 'xml' might fail with some encodings or malformed headers
            # 'html.parser' is more lenient
            content = f.read()
            soup = BeautifulSoup(content, 'xml')

        # Try finding tags with or without namespace prefixes
        title_tag = soup.find('title') or soup.find('dc:title')
        title = title_tag.get_text() if title_tag else book_dir_name

        creator_tag = soup.find('creator') or soup.find('dc:creator')
        author = creator_tag.get_text() if creator_tag else "Unknown"

        # Extract Subjects (Categories)
        subjects = []
        # Find all tags that might be subjects
        for tag in soup.find_all(['subject', 'dc:subject']):
            text = tag.get_text().strip()
            if text:
                subjects.append(text)

        # Cover finding: prioritize EPUB standards and handle common EPUB2 quirks.
        image_exts = ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif')

        def strip_fragment_and_query(value):
            value = value.split('#', 1)[0]
            value = value.split('?', 1)[0]
            return value

        def looks_like_path(value):
            value = (value or '').strip()
            return (
                '/' in value
                or '\\' in value
                or any(value.lower().endswith(ext) for ext in image_exts)
            )

        def resolve_href_to_relpath(href, base_dir):
            if not href:
                return None
            href = unquote(strip_fragment_and_query(href)).strip()
            if not href:
                return None
            href = href.replace('\\', '/')
            full_path = os.path.normpath(os.path.join(base_dir, href))
            full_real = os.path.realpath(full_path)
            if not (full_real == book_root_real or full_real.startswith(book_root_real + os.sep)):
                return None
            if os.path.isfile(full_path):
                return os.path.relpath(full_path, LIBRARY_FOLDER)
            return None

        def extract_cover_from_xhtml(xhtml_full_path):
            xhtml_real = os.path.realpath(xhtml_full_path)
            if not (xhtml_real == book_root_real or xhtml_real.startswith(book_root_real + os.sep)):
                return None
            try:
                with open(xhtml_full_path, 'r', encoding='utf-8', errors='ignore') as xf:
                    xhtml = xf.read()
            except Exception:
                return None

            try:
                doc = BeautifulSoup(xhtml, 'html.parser')
            except Exception:
                return None

            xhtml_dir = os.path.dirname(xhtml_full_path)

            img = doc.find('img')
            if img and img.get('src'):
                return resolve_href_to_relpath(img.get('src'), xhtml_dir)

            svg_image = doc.find('image')
            if svg_image:
                href = (
                    svg_image.get('href')
                    or svg_image.get('xlink:href')
                    or svg_image.get('{http://www.w3.org/1999/xlink}href')
                )
                if href:
                    return resolve_href_to_relpath(href, xhtml_dir)

            return None

        cover_path = None
        cover_item = None
        manifest = soup.find('manifest')
        opf_dir = os.path.dirname(opf_path)

        if manifest:
            # 1) EPUB 3: properties="cover-image"
            cover_item = manifest.find('item', attrs={'properties': lambda x: x and 'cover-image' in x})

            # 2) EPUB 2: <meta name="cover" content="item-id" /> (sometimes incorrectly a path)
            if not cover_item and not cover_path:
                meta_cover = soup.find('meta', attrs={'name': 'cover'})
                if meta_cover:
                    cover_ref = (meta_cover.get('content') or '').strip()
                    if cover_ref:
                        cover_item = manifest.find('item', id=cover_ref) or manifest.find('item', attrs={'href': cover_ref})
                        if not cover_item and looks_like_path(cover_ref):
                            cover_path = resolve_href_to_relpath(cover_ref, opf_dir)

            # 3) Common conventions
            if not cover_item:
                cover_item = (
                    manifest.find('item', id='cover-image')
                    or manifest.find('item', id='cover')
                )

            # 4) If the selected item isn't an image, try extracting from its XHTML wrapper.
            if not cover_path and cover_item:
                href = cover_item.get('href') or ''
                media_type = (cover_item.get('media-type') or '').strip().lower()
                if href:
                    rel_candidate = resolve_href_to_relpath(href, opf_dir)
                    is_image = media_type.startswith('image/') or any(href.lower().endswith(ext) for ext in image_exts)
                    if is_image:
                        cover_path = rel_candidate
                    else:
                        full_xhtml_path = os.path.normpath(os.path.join(opf_dir, unquote(strip_fragment_and_query(href))))
                        cover_path = extract_cover_from_xhtml(full_xhtml_path) or rel_candidate

            # 5) Final fallback: first image item whose id/href suggests it's a cover.
            if not cover_path:
                for item in manifest.find_all('item'):
                    href = (item.get('href') or '').strip()
                    media_type = (item.get('media-type') or '').strip().lower()
                    item_id = (item.get('id') or '').lower()
                    if not href or not media_type.startswith('image/'):
                        continue
                    if 'cover' in item_id or 'cover' in href.lower():
                        cover_path = resolve_href_to_relpath(href, opf_dir)
                        if cover_path:
                            break

        return {
            "title": title,
            "author": author,
            "dir": book_dir_name,
            "cover": cover_path,
            "subjects": subjects
        }
        
    except Exception as e:
        print(f"Metadata error for {book_dir}: {e}")
        return {
            "title": book_dir_name,
            "author": "Unknown",
            "dir": book_dir_name,
            "cover": None,
            "subjects": []
        }

def load_user_metadata():
    if not os.path.exists(USER_METADATA_FILE):
        return {}
    try:
        with open(USER_METADATA_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading user metadata: {e}")
        return {}

def save_user_metadata(data):
    try:
        with open(USER_METADATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving user metadata: {e}")

# --- Routes ---

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    # 1. Try serving from root (Application files)
    if os.path.exists(os.path.join('.', path)):
        return send_from_directory('.', path)
    
    # 2. Try serving from Library (Book files)
    if os.path.exists(os.path.join(LIBRARY_FOLDER, path)):
        return send_from_directory(LIBRARY_FOLDER, path)
        
    return "File not found", 404

@app.route('/api/books')
def api_books():
    books = []
    user_meta = load_user_metadata()
    print("Scanning for books...")
    if os.path.exists(LIBRARY_FOLDER):
        for entry in os.listdir(LIBRARY_FOLDER):
            full_path = os.path.join(LIBRARY_FOLDER, entry)
            if os.path.isdir(full_path):
                # print(f"Checking directory: {entry}")
                # Check if it looks like a book (has .opf or index.html)
                # Simplest check: try to get metadata
                meta = get_book_metadata(entry)
                if meta:
                    # print(f"Found book: {meta['title']}")
                    
                    # Reset subjects to ignore EPUB metadata as per user request
                    meta['subjects'] = []

                    # Merge user categories
                    if entry in user_meta and 'categories' in user_meta[entry]:
                        # Combine and deduplicate
                        meta['subjects'] = list(set(meta['subjects'] + user_meta[entry]['categories']))
                    
                    books.append(meta)
    return jsonify(books)

@app.route('/api/user-metadata', methods=['GET', 'POST'])
def api_user_metadata():
    if request.method == 'GET':
        return jsonify(load_user_metadata())
    
    if request.method == 'POST':
        data = request.json
        # Expecting { "book_dir": "...", "categories": [...] }
        book_dir = data.get('book_dir')
        categories = data.get('categories')
        
        if not book_dir or categories is None:
            return jsonify({'error': 'Missing book_dir or categories'}), 400
            
        user_meta = load_user_metadata()
        if book_dir not in user_meta:
            user_meta[book_dir] = {}
            
        user_meta[book_dir]['categories'] = categories
        save_user_metadata(user_meta)
        
        return jsonify({'success': True, 'categories': categories})

@app.route('/api/upload-status/<task_id>')
def api_upload_status(task_id):
    _prune_upload_tasks()

    try:
        since = int(request.args.get('since', '0'))
    except Exception:
        since = 0
    if since < 0:
        since = 0

    with UPLOAD_TASKS_LOCK:
        task = UPLOAD_TASKS.get(task_id)
        if not task:
            return jsonify({'found': False}), 404

        logs = task.get('logs', [])
        new_logs = logs[since:]
        progress = task.get('progress') or {}
        status = task.get('status')
        book_dir = task.get('book_dir')
        error = task.get('error')
        next_index = len(logs)

    # Compute percent in a stable way for UI.
    current = int(progress.get('current') or 0)
    total = int(progress.get('total') or 0)
    percent = int((current * 100 / total)) if total > 0 else 0

    return jsonify({
        'found': True,
        'status': status,
        'phase': progress.get('phase'),
        'current': current,
        'total': total,
        'percent': percent,
        'logs': new_logs,
        'next_index': next_index,
        'book_dir': book_dir,
        'error': error,
    })

@app.route('/api/upload', methods=['POST'])
def api_upload():
    _prune_upload_tasks()
    logs = []
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if file:
        filename = file.filename
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        file.save(filepath)
        log(logs, f"File uploaded: {filename}")

        # Async mode: return immediately and let the client poll for progress/logs.
        if request.args.get('async') == '1':
            categories = request.form.getlist('categories')
            task_id = str(uuid.uuid4())
            now = time.time()
            with UPLOAD_TASKS_LOCK:
                UPLOAD_TASKS[task_id] = {
                    'id': task_id,
                    'status': 'queued',
                    'created_at': now,
                    'updated_at': now,
                    'logs': [],
                    'progress': {'phase': 'queued', 'current': 0, 'total': 0},
                    'book_dir': None,
                    'error': None,
                }
            _task_append_log(task_id, f"Upload received: {filename}")
            worker = threading.Thread(
                target=_process_upload_task,
                args=(task_id, filepath, filename, categories),
                daemon=True,
            )
            worker.start()
            return jsonify({'success': True, 'task_id': task_id})
        
        # 1. Unzip
        # Create a directory name based on filename without extension
        book_name_safe = os.path.splitext(filename)[0]
        # Clean weird chars
        book_name_safe = re.sub(r'[^\w\-\u4e00-\u9fa5]', '_', book_name_safe) 
        
        extract_path = os.path.join(LIBRARY_FOLDER, book_name_safe)
        
        # Handle collision
        if os.path.exists(extract_path):
            extract_path += "_" + str(uuid.uuid4())[:8]
            
        try:
            with zipfile.ZipFile(filepath, 'r') as zip_ref:
                zip_ref.extractall(extract_path)
            log(logs, f"Extracted to: {extract_path}")
            
            # 2. Process Files
            # Walk through the extracted files
            for root, dirs, files in os.walk(extract_path):
                for file in files:
                    full_path = os.path.join(root, file)
                    
                    if file.lower().endswith('.css'):
                        convert_css_vertical_to_horizontal(full_path, logs)
                    
                    if file.lower().endswith(('.html', '.xhtml')):
                        convert_css_vertical_to_horizontal(full_path, logs) # Inline styles
                        process_html_content(full_path, logs) # Nav injection & Title cleaning
            
            # Cleanup Upload
            os.remove(filepath)
            
            # 3. Save Metadata (Categories) if provided
            categories = request.form.getlist('categories')
            if categories:
                user_meta = load_user_metadata()
                book_dir_name = os.path.basename(extract_path)
                if book_dir_name not in user_meta:
                    user_meta[book_dir_name] = {}
                
                # Add to categories, avoiding duplicates
                current_cats = user_meta[book_dir_name].get('categories', [])
                for cat in categories:
                    cat = cat.strip()
                    if cat and cat not in current_cats:
                        current_cats.append(cat)
                
                user_meta[book_dir_name]['categories'] = current_cats
                save_user_metadata(user_meta)
                log(logs, f"Added categories: {', '.join(categories)}")

            return jsonify({'success': True, 'logs': logs, 'book_dir': os.path.basename(extract_path)})

        except Exception as e:
            log(logs, f"Error processing: {e}")
            return jsonify({'success': False, 'logs': logs, 'error': str(e)}), 500

@app.route('/api/books/<book_dir>', methods=['DELETE'])
def api_delete_book(book_dir):
    # Security check: Prevent path traversal
    if ".." in book_dir or book_dir.startswith('/'):
        return jsonify({'error': 'Invalid book directory provided.'}), 400
    
    full_path = os.path.join(LIBRARY_FOLDER, book_dir)
    
    # Ensure it's a valid book directory that we manage
    # Check if the directory exists and is not one of the protected IGNORE_DIRS
    if not os.path.isdir(full_path) or book_dir in IGNORE_DIRS:
        return jsonify({'error': 'Book not found or is a protected directory.'}), 404
    
    try:
        shutil.rmtree(full_path)
        # Keep user metadata in sync: remove any stored metadata for this book dir.
        user_meta = load_user_metadata()
        if book_dir in user_meta:
            user_meta.pop(book_dir, None)
            save_user_metadata(user_meta)
        print(f"Deleted book directory: {full_path}")
        return jsonify({'success': True, 'message': f'Book "{book_dir}" deleted.'}), 200
    except Exception as e:
        print(f"Error deleting book {book_dir}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

if __name__ == '__main__':
    print("Starting server on port 8000...")
    app.run(host='0.0.0.0', port=8000)
