// library_pwa.js - Client-side Library Management using IndexedDB

// DBManager is now imported from db_manager.js

const dbManager = new DBManager();

document.addEventListener('DOMContentLoaded', async () => {
    log('PWA Library Initialized.');
    await dbManager.open();
    loadBooks();

    const fileInput = document.getElementById('file-input');
    const clearDbBtn = document.getElementById('clear-db-btn');
    const searchInput = document.getElementById('search-input');

    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (file) {
            processEpub(file);
            // Reset input so same file can be selected again if needed
            fileInput.value = ''; 
        }
    });

    clearDbBtn.addEventListener('click', () => {
        if(confirm('Are you sure you want to delete all books? This action cannot be undone.')) {
            indexedDB.deleteDatabase(DB_NAME);
            setTimeout(() => location.reload(), 500);
        }
    });
    
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        document.querySelectorAll('.book-card').forEach(card => {
            const title = card.querySelector('.book-title').textContent.toLowerCase();
            const author = card.querySelector('.book-author').textContent.toLowerCase();
            if (title.includes(term) || author.includes(term)) {
                card.style.display = 'flex';
            } else {
                card.style.display = 'none';
            }
        });
    });
});

async function loadBooks() {
    const bookListEl = document.getElementById('book-list');
    const emptyStateEl = document.getElementById('empty-state');
    
    bookListEl.innerHTML = '';
    
    const books = await dbManager.getBooks();
    
    if (books.length === 0) {
        emptyStateEl.style.display = 'flex';
        emptyStateEl.style.flexDirection = 'column';
        emptyStateEl.style.alignItems = 'center';
        emptyStateEl.style.marginTop = '50px';
        return;
    } else {
        emptyStateEl.style.display = 'none';
    }

    // Sort by added date (newest first)
    books.sort((a, b) => b.addedAt - a.addedAt);

    books.forEach(book => {
        const card = document.createElement('div');
        card.className = 'book-card';
        // Add minimal inline style for PWA specific card tweaks if needed, 
        // but try to rely on style.css
        
        const coverUrl = book.coverPath ? `books/${book.id}/${book.coverPath}` : null;
        
        // Random gradient if no cover
        const noCoverStyle = `background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; align-items: center; justify-content: center; color: white; font-size: 2rem;`;

        card.innerHTML = `
            <a href="viewer.html?book=books/${book.id}" class="book-link">
                <div class="book-cover" style="${!coverUrl ? noCoverStyle : ''}">
                    ${coverUrl ? `<img src="${coverUrl}" loading="lazy" alt="${book.title}">` : '<i class="fas fa-book"></i>'}
                </div>
                <div class="book-info">
                    <div class="book-title" title="${book.title}">${book.title}</div>
                    <div class="book-author">${book.author || 'Unknown Author'}</div>
                </div>
            </a>
            <div class="book-actions">
                <a href="viewer.html?book=books/${book.id}" class="action-btn read-btn" title="Read"><i class="fas fa-book-open"></i> Read</a>
                <button class="action-btn delete-btn" data-id="${book.id}" title="Delete"><i class="fas fa-trash"></i></button>
            </div>
        `;
        bookListEl.appendChild(card);
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.preventDefault(); // Prevent default button action (e.g., form submission)
                        e.stopPropagation(); // Stop click from bubbling up to parent anchor
                        // Find closest button in case icon was clicked
                        const button = e.target.closest('button');
                        const id = button.dataset.id;
                        
                        if(confirm('Delete this book?')) {
                            await dbManager.deleteBook(id);
                            loadBooks();
                            showToast("Book deleted");
                        }
                    });    });
}

async function processEpub(file) {
    showToast('Importing EPUB... Please wait.');
    try {
        const zip = await JSZip.loadAsync(file);
        
        // 1. Generate Book ID
        const bookId = file.name.replace(/[^a-zA-Z0-9]/g, '_').replace('.epub', '') + '_' + Date.now().toString().slice(-4);
        
        // 2. Find OPF
        const containerFile = zip.file("META-INF/container.xml");
        if (!containerFile) throw new Error("Invalid EPUB: Missing META-INF/container.xml");
        
        const containerXml = await containerFile.async("text");
        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXml, "application/xml");
        const rootPath = containerDoc.querySelector("rootfile").getAttribute("full-path");

        // Parse OPF
        const opfFile = zip.file(rootPath);
        if (!opfFile) throw new Error(`Invalid EPUB: Missing OPF file at ${rootPath}`);
        
        const opfXml = await opfFile.async("text");
        const opfDoc = parser.parseFromString(opfXml, "application/xml");
        
        const title = opfDoc.querySelector("metadata > title")?.textContent || "Untitled";
        const creator = opfDoc.querySelector("metadata > creator")?.textContent || "Unknown";
        
        // Try to find cover
        let coverPath = null;
        const coverMeta = opfDoc.querySelector('metadata > meta[name="cover"]');
        if (coverMeta) {
            const coverId = coverMeta.getAttribute('content');
            const item = opfDoc.querySelector(`manifest > item[id="${coverId}"]`);
            if (item) {
                const href = item.getAttribute('href');
                const opfDir = rootPath.substring(0, rootPath.lastIndexOf('/'));
                coverPath = opfDir ? `${opfDir}/${href}` : href;
            }
        }

        // 3. Prepare files for DB
        const dbFiles = [];
        const filesToProcess = [];

        zip.forEach((relativePath, zipEntry) => {
            if (!zipEntry.dir) {
                filesToProcess.push({ path: relativePath, entry: zipEntry });
            }
        });

        // Batch process
        for (const item of filesToProcess) {
            const type = item.path.match(/\.(html|xhtml|xml|css|opf|ncx|svg|js)$/i) ? 'text' : 'blob';
            
            let content;
            if (type === 'text') {
                content = await item.entry.async("string");
            } else {
                content = await item.entry.async("blob");
            }

            dbFiles.push({
                path: `${bookId}/${item.path}`,
                bookId: bookId,
                filePath: item.path,
                content: content
            });
        }

        // 4. Save to DB
        await dbManager.addBook({
            id: bookId,
            title: title,
            author: creator,
            coverPath: coverPath,
            addedAt: Date.now()
        }, dbFiles);

        showToast('Import successful!');
        loadBooks();

    } catch (e) {
        console.error(e);
        showToast('Error: ' + e.message);
    }
}