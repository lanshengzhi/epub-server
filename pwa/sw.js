const CACHE_NAME = 'gemini-reader-v1';
const DB_NAME = 'GeminiReaderDB';
const DB_VERSION = 1;

// Install & Activate
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

// Helper: Get MIME type
function getMimeType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
        'html': 'text/html',
        'xhtml': 'application/xhtml+xml',
        'xml': 'application/xml',
        'css': 'text/css',
        'js': 'text/javascript',
        'json': 'application/json',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'svg': 'image/svg+xml',
        'webp': 'image/webp',
        'ttf': 'font/ttf',
        'otf': 'font/otf',
        'woff': 'font/woff',
        'woff2': 'font/woff2',
        'opf': 'application/oebps-package+xml',
        'ncx': 'application/x-dtbncx+xml'
    };
    return map[ext] || 'application/octet-stream';
}

// Helper: Read from IndexedDB
function getFileFromDB(path) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onerror = () => reject('DB Error');
        req.onsuccess = (e) => {
            const db = e.target.result;
            const tx = db.transaction(['books_files'], 'readonly');
            const store = tx.objectStore('books_files');
            // The key is the full path e.g. "my_book_id/OEBPS/chapter1.html"
            // The path passed here should match exactly what we stored.
            // URL decoding might be needed if the browser percent-encodes the URL.
            const key = decodeURIComponent(path); 
            
            const getReq = store.get(key);
            getReq.onsuccess = () => {
                if (getReq.result) {
                    resolve(getReq.result.content);
                } else {
                    resolve(null);
                }
            };
            getReq.onerror = () => reject('File not found');
        };
    });
}

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    
    // Check if this is a request for a book file
    // Pattern: /pwa/books/{bookId}/... or just books/{bookId}/... relative to scope
    // Our scope is /pwa/, so request will be like https://.../pwa/books/...
    
    if (url.pathname.includes('/books/')) {
        // Extract the path after '/books/'
        const parts = url.pathname.split('/books/');
        if (parts.length > 1) {
            let relativePath = parts[1]; // e.g., "MyBook/chapter1.html"
            
            // Fix: Remove double slashes if any, and decode
            relativePath = decodeURIComponent(relativePath).replace(/\/\/+/g, '/');
            
            console.log(`[SW] Request: ${url.pathname} -> DB Key: ${relativePath}`);

            event.respondWith((async () => {
                try {
                    const content = await getFileFromDB(relativePath);
                    if (content) {
                        const mimeType = getMimeType(relativePath);
                        return new Response(content, {
                            status: 200,
                            headers: { 'Content-Type': mimeType }
                        });
                    } else {
                         console.warn(`[SW] 404 Not Found in DB: ${relativePath}`);
                         return new Response('File not found in PWA DB', { status: 404 });
                    }
                } catch (e) {
                    console.error('[SW] DB Error:', e);
                    return new Response('Internal PWA Error', { status: 500 });
                }
            })());
            return;
        }
    }

    // Default: Network First (or Cache First for static assets if we implemented that)
    event.respondWith(fetch(event.request));
});