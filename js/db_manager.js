// db_manager.js - Shared IndexedDB Logic

const DB_NAME = 'GeminiReaderDB';
const DB_VERSION = 1;

class DBManager {
    constructor() {
        this.db = null;
    }

    async open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => {
                console.error("Database error: " + event.target.errorCode);
                reject(event.target.error);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('books_meta')) {
                    db.createObjectStore('books_meta', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('books_files')) {
                    const filesStore = db.createObjectStore('books_files', { keyPath: 'path' });
                    filesStore.createIndex('bookId', 'bookId', { unique: false });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };
        });
    }

    async addBook(metadata, files) {
        return new Promise((resolve, reject) => {
            if (!this.db) { reject('DB not open'); return; }
            const transaction = this.db.transaction(['books_meta', 'books_files'], 'readwrite');
            
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e) => reject(e.target.error);

            const metaStore = transaction.objectStore('books_meta');
            metaStore.put(metadata);

            const fileStore = transaction.objectStore('books_files');
            files.forEach(file => {
                fileStore.put(file);
            });
        });
    }

    async getBooks() {
        return new Promise((resolve, reject) => {
            if (!this.db) { reject('DB not open'); return; }
            const transaction = this.db.transaction(['books_meta'], 'readonly');
            const store = transaction.objectStore('books_meta');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteBook(bookId) {
        return new Promise((resolve, reject) => {
             if (!this.db) { reject('DB not open'); return; }
             const transaction = this.db.transaction(['books_meta', 'books_files'], 'readwrite');
             
             transaction.oncomplete = () => resolve();
             transaction.onerror = (e) => reject(e.target.error);

             transaction.objectStore('books_meta').delete(bookId);

             const fileStore = transaction.objectStore('books_files');
             const index = fileStore.index('bookId');
             const request = index.getAllKeys(bookId);
             
             request.onsuccess = () => {
                 const keys = request.result;
                 keys.forEach(key => fileStore.delete(key));
             };
        });
    }

    async getFile(path) {
        return new Promise((resolve, reject) => {
            if (!this.db) { 
                // Attempt auto-open if closed
                this.open().then(() => this.getFile(path).then(resolve).catch(reject)).catch(reject);
                return;
            }
            const transaction = this.db.transaction(['books_files'], 'readonly');
            const store = transaction.objectStore('books_files');
            // Ensure path matches DB key format (no leading slash, etc)
            // Our DB keys are like "BookID/OEBPS/file.html"
            const request = store.get(path);
            
            request.onsuccess = () => {
                if (request.result) resolve(request.result);
                else resolve(null);
            };
            request.onerror = () => reject(request.error);
        });
    }
}
