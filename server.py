import os
import shutil
import zipfile
import re
import uuid
import glob
import json
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
        
        # Cover finding: Prioritize EPUB standards
        cover_path = None
        cover_item = None
        manifest = soup.find('manifest')

        if manifest:
            # 1. EPUB 3: properties="cover-image"
            cover_item = manifest.find('item', attrs={'properties': lambda x: x and 'cover-image' in x})
            
            # 2. EPUB 2: <meta name="cover" content="item-id" />
            if not cover_item:
                meta_cover = soup.find('meta', attrs={'name': 'cover'})
                if meta_cover:
                    cover_id = meta_cover.get('content')
                    if cover_id:
                        cover_item = manifest.find('item', id=cover_id)

            # 3. Fallback: Exact id="cover" (Common convention)
            if not cover_item:
                cover_item = manifest.find('item', id="cover")

            if cover_item:
                href = cover_item.get('href')
                if href:
                    # Resolve path relative to OPF
                    opf_dir = os.path.dirname(opf_path)
                    full_cover_path = os.path.join(opf_dir, href)
                    # Make relative to root for the frontend
                    # Note: Since we are moving books to 'library/', the relative path from root
                    # should actually be relative to the book dir if we serve it under /book_dir/
                    # but if we serve via generic path, we want the path that the browser can fetch.
                    # Since serve_static handles lookup in library folder, 
                    # we can return "BookDir/PathToCover"
                    
                    # relpath from LIBRARY_FOLDER
                    rel_to_lib = os.path.relpath(full_cover_path, LIBRARY_FOLDER)
                    cover_path = rel_to_lib # e.g. "progit/cover.jpg"
    
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

@app.route('/api/upload', methods=['POST'])
def api_upload():
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
        print(f"Deleted book directory: {full_path}")
        return jsonify({'success': True, 'message': f'Book "{book_dir}" deleted.'}), 200
    except Exception as e:
        print(f"Error deleting book {book_dir}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

if __name__ == '__main__':
    print("Starting server on port 8000...")
    app.run(host='0.0.0.0', port=8000)
