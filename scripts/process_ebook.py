import os
import sys
from bs4 import BeautifulSoup

def process_html_file(filepath):
    """
    Reads an HTML file, cleans titles, and saves the changes back to the original file.
    """
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        soup = BeautifulSoup(content, 'lxml')

        # --- Title cleaning logic from convert.py ---
        # Find all <p> tags containing an <a> tag and unwrap the link (remove tag but keep content)
        # This preserves other tags like <ruby> inside the paragraph.
        modified = False
        for p_tag in soup.find_all('p'):
            links = p_tag.find_all('a')
            if links:
                for a_tag in links:
                    a_tag.unwrap()
                modified = True
                print(f"Fixed linked title in: {os.path.basename(filepath)}")


        # If any changes were made, write them back to the file
        if modified:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(str(soup))

    except Exception as e:
        print(f"Error processing file {filepath}: {e}")

def main():
    ebook_dirs = []
    
    if len(sys.argv) < 2:
        # Default to processing all books in 'library' directory
        library_path = 'library'
        if not os.path.exists(library_path) and os.path.exists(os.path.join('..', 'library')):
            library_path = os.path.join('..', 'library')
            
        if os.path.exists(library_path):
            print(f"No arguments provided. Scanning '{library_path}' for books...")
            for entry in os.listdir(library_path):
                full_path = os.path.join(library_path, entry)
                if os.path.isdir(full_path):
                    ebook_dirs.append(full_path)
        else:
            print("Usage: python process_ebook.py <ebook_dir_1> <ebook_dir_2> ...")
            print("       Or run without arguments to process all books in 'library/' folder.")
            sys.exit(1)
    else:
        ebook_dirs = sys.argv[1:]

    for ebook_dir in ebook_dirs:
        # Support both standard OPS structure and just searching for HTMLs? 
        # The original script looked specifically for OPS/xhtml.
        # Let's make it a bit more flexible: OPS/xhtml, OEBPS/text, or just look for .html recursively?
        # Original: os.path.join(ebook_dir, 'OPS', 'xhtml')
        
        # Let's try to find the content directory
        content_dirs = [
            os.path.join(ebook_dir, 'OPS', 'xhtml'),
            os.path.join(ebook_dir, 'OEBPS', 'text'),
            os.path.join(ebook_dir, 'OPS'),
            os.path.join(ebook_dir, 'OEBPS'),
            os.path.join(ebook_dir, 'html'), # Some books have just html/
            ebook_dir # Fallback: scan root of book
        ]
        
        processed = False
        for c_dir in content_dirs:
            if os.path.isdir(c_dir):
                # Check if there are html files here
                html_files = [f for f in os.listdir(c_dir) if f.endswith('.html') or f.endswith('.xhtml')]
                if html_files:
                    print(f"\nProcessing files in '{c_dir}'...")
                    for filename in html_files:
                        process_html_file(os.path.join(c_dir, filename))
                    print(f"Finished processing directory: {c_dir}")
                    processed = True
                    # Don't break immediately if we want to find all, but usually one main folder is enough.
                    # But some books might be split. Let's process the first valid one we find that matches standard structure
                    # OR if we fell back to ebook_dir, be careful.
                    break
        
        if not processed:
            print(f"Warning: Could not find standard content directory (OPS/xhtml, OEBPS/text) in '{ebook_dir}'. Skipping.")

if __name__ == "__main__":
    main()
