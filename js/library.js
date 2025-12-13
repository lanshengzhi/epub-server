document.addEventListener('DOMContentLoaded', () => {
    const bookList = document.getElementById('book-list');
    const themeToggle = document.getElementById('theme-toggle');
    const importBtn = document.getElementById('import-btn');
    const fileInput = document.getElementById('file-input');
    const uploadModal = document.getElementById('upload-modal');
    const uploadLogs = document.getElementById('upload-logs');
    const closeModal = document.getElementById('close-modal');
    const uploadStatus = document.getElementById('upload-status');

    // Controls
    const sortSelect = document.getElementById('sort-select');
    const viewGridBtn = document.getElementById('view-grid');
    const viewListBtn = document.getElementById('view-list');
    const categoryList = document.getElementById('category-list');

    let booksData = [];
    let currentView = 'grid'; // 'grid' or 'list'
    let currentSort = 'title'; // 'title' or 'author'
    let currentCategory = 'all';

    // Fetch and Render Books
    async function loadBooks() {
        if (window.location.protocol === 'file:') {
             bookList.innerHTML = '<p class="error">You are viewing this file directly via file://. This application requires a web server to function correctly (due to CORS policies).<br>Please run <code>python3 server.py</code> and visit <a href="http://localhost:8000">http://localhost:8000</a>.</p>';
             return;
        }

        try {
            const response = await fetch('/api/books');
            if (!response.ok) throw new Error('Failed to fetch books: ' + response.statusText);
            booksData = await response.json();
            updateCategories();
            updateDisplay();
        } catch (error) {
            console.error('Error loading books:', error);
            // Fallback to empty or error message
            bookList.innerHTML = `<p class="error">Could not load library. Ensure server.py is running.<br><small>${error.message}</small></p>`;
        }
    }

    function updateCategories() {
        const categories = {};
        
        booksData.forEach(book => {
            if (book.subjects && book.subjects.length > 0) {
                book.subjects.forEach(subject => {
                    categories[subject] = (categories[subject] || 0) + 1;
                });
            } else {
                categories['Uncategorized'] = (categories['Uncategorized'] || 0) + 1;
            }
        });

        // Clear list but keep "All Books" (re-render it to update count)
        categoryList.innerHTML = '';

        // Add "All Books"
        const allLi = document.createElement('li');
        allLi.className = currentCategory === 'all' ? 'active' : '';
        allLi.innerHTML = `All Books <span class="count">${booksData.length}</span>`;
        allLi.addEventListener('click', () => {
            currentCategory = 'all';
            updateCategories(); // Re-render to update active class
            updateDisplay();
        });
        categoryList.appendChild(allLi);

        // Add other categories
        Object.keys(categories).sort().forEach(cat => {
            const li = document.createElement('li');
            li.className = currentCategory === cat ? 'active' : '';
            li.innerHTML = `${cat} <span class="count">${categories[cat]}</span>`;
            li.addEventListener('click', () => {
                currentCategory = cat;
                updateCategories();
                updateDisplay();
            });
            categoryList.appendChild(li);
        });
    }

    function updateDisplay() {
        // Filter
        let filteredBooks = booksData;
        if (currentCategory !== 'all') {
            if (currentCategory === 'Uncategorized') {
                filteredBooks = booksData.filter(b => !b.subjects || b.subjects.length === 0);
            } else {
                filteredBooks = booksData.filter(b => b.subjects && b.subjects.includes(currentCategory));
            }
        }

        // Sort
        const sortedBooks = [...filteredBooks].sort((a, b) => {
            const valA = (a[currentSort] || '').toString().toLowerCase();
            const valB = (b[currentSort] || '').toString().toLowerCase();
            return valA.localeCompare(valB);
        });

        // Toggle View Classes
        if (currentView === 'list') {
            bookList.classList.remove('library-grid');
            bookList.classList.add('library-list');
        } else {
            bookList.classList.remove('library-list');
            bookList.classList.add('library-grid');
        }

        renderBooks(sortedBooks);
    }

    // Event Listeners for Controls
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            currentSort = e.target.value;
            updateDisplay();
        });
    }

    if (viewGridBtn && viewListBtn) {
        viewGridBtn.addEventListener('click', () => {
            currentView = 'grid';
            viewGridBtn.classList.add('active');
            viewListBtn.classList.remove('active');
            updateDisplay();
        });

        viewListBtn.addEventListener('click', () => {
            currentView = 'list';
            viewListBtn.classList.add('active');
            viewGridBtn.classList.remove('active');
            updateDisplay();
        });
    }

    function renderBooks(books) {
        bookList.innerHTML = '';
        if (books.length === 0) {
            bookList.innerHTML = '<p>No books found. Import one!</p>';
            return;
        }

        books.forEach(book => {
            const card = document.createElement('a');
            card.className = 'book-card';
            card.href = `viewer.html?book=${encodeURIComponent(book.dir)}`;

            // Handle cover error
            const coverHtml = book.cover 
                ? `<img src="${book.cover}" alt="${book.title}" onerror="this.parentElement.innerHTML='<div class=\'placeholder\'><i class=\'fas fa-book\'></i></div>'">`
                : `<div class="placeholder"><i class="fas fa-book"></i></div>`;

            card.innerHTML = `
                <div class="book-cover">
                    ${coverHtml}
                </div>
                <div class="book-info">
                    <h3>${book.title}</h3>
                    <p>${book.author}</p>
                </div>
                <button class="edit-tags-btn" data-book-dir="${book.dir}" title="Edit Categories">
                    <i class="fas fa-tags"></i>
                </button>
                <button class="delete-btn" data-book-dir="${book.dir}" title="Delete Book">
                    <i class="fas fa-trash-alt"></i>
                </button>
            `;
            bookList.appendChild(card);
        });
        
        // Add event listeners for edit buttons
        document.querySelectorAll('.edit-tags-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const bookDir = button.dataset.bookDir;
                openCategoryModal(bookDir);
            });
        });

        // Add event listeners for delete buttons
        document.querySelectorAll('.delete-btn').forEach(button => {
            button.addEventListener('click', async (e) => {
                e.preventDefault(); // Prevent navigating to the book
                e.stopPropagation(); // Stop event from bubbling up to the card's click
                const bookDir = button.dataset.bookDir;
                if (confirm(`Are you sure you want to delete "${decodeURIComponent(bookDir)}"? This cannot be undone.`)) {
                    await deleteBook(bookDir);
                }
            });
        });
    }

    // --- Category Modal Logic ---
    const catModal = document.getElementById('category-modal');
    const catBookTitle = document.getElementById('cat-book-title');
    const newTagInput = document.getElementById('new-tag-input');
    const addTagBtn = document.getElementById('add-tag-btn');
    const activeTagsContainer = document.getElementById('active-tags');
    const suggestedTagsContainer = document.getElementById('suggested-tags');
    const saveTagsBtn = document.getElementById('save-tags-btn');
    const closeCatModal = document.getElementById('close-cat-modal');

    let currentEditingBook = null;
    let tempTags = [];
    let allLibraryTags = new Set();

    function openCategoryModal(bookDir) {
        const book = booksData.find(b => b.dir === bookDir);
        if (!book) return;

        // Collect all existing tags from the library
        allLibraryTags = new Set();
        booksData.forEach(b => {
            if (b.subjects) b.subjects.forEach(t => allLibraryTags.add(t));
        });

        currentEditingBook = book;
        tempTags = [...(book.subjects || [])]; // Copy existing tags
        
        catBookTitle.innerText = book.title;
        renderTags();
        renderSuggestedTags();
        
        catModal.classList.add('show');
        newTagInput.focus();
    }

    function renderTags() {
        activeTagsContainer.innerHTML = '';
        tempTags.forEach((tag, index) => {
            const pill = document.createElement('div');
            pill.className = 'tag-pill';
            pill.innerHTML = `
                ${tag} 
                <span class="remove-tag" data-index="${index}"><i class="fas fa-times"></i></span>
            `;
            activeTagsContainer.appendChild(pill);
        });

        // Add listeners for remove
        document.querySelectorAll('.remove-tag').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                tempTags.splice(idx, 1);
                renderTags();
                renderSuggestedTags(); // Refresh suggestions
            });
        });
    }

    function renderSuggestedTags() {
        if (!suggestedTagsContainer) return;
        suggestedTagsContainer.innerHTML = '';
        
        const sortedTags = Array.from(allLibraryTags).sort();
        
        sortedTags.forEach(tag => {
            // Only show if not already selected
            if (!tempTags.includes(tag)) {
                const pill = document.createElement('div');
                pill.className = 'suggested-tag';
                pill.innerText = tag;
                pill.addEventListener('click', () => {
                    tempTags.push(tag);
                    renderTags();
                    renderSuggestedTags();
                });
                suggestedTagsContainer.appendChild(pill);
            }
        });
        
        if (suggestedTagsContainer.children.length === 0) {
            suggestedTagsContainer.innerHTML = '<span style="color:var(--text-muted); font-size: 0.9rem;">No other existing tags.</span>';
        }
    }

    if (addTagBtn) {
        addTagBtn.addEventListener('click', () => {
            const tag = newTagInput.value.trim();
            if (tag && !tempTags.includes(tag)) {
                tempTags.push(tag);
                newTagInput.value = '';
                renderTags();
                renderSuggestedTags();
            }
        });
        
        // Enter key to add tag
        newTagInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                addTagBtn.click();
            }
        });
    }

    if (saveTagsBtn) {
        saveTagsBtn.addEventListener('click', async () => {
            if (!currentEditingBook) return;

            try {
                const response = await fetch('/api/user-metadata', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        book_dir: currentEditingBook.dir,
                        categories: tempTags
                    })
                });

                if (response.ok) {
                    // Update local data optimistically or reload
                    // To be safe and simple, let's reload books
                    catModal.classList.remove('show');
                    loadBooks(); 
                } else {
                    alert('Failed to save categories.');
                }
            } catch (e) {
                console.error(e);
                alert('Error saving categories.');
            }
        });
    }

    if (closeCatModal) {
        closeCatModal.addEventListener('click', () => {
            catModal.classList.remove('show');
        });
    }

    // --- Upload Logic ---
    const importOptionsModal = document.getElementById('import-options-modal');
    const importFilename = document.getElementById('import-filename');
    
    // New Import Tag Elements
    const importNewTagInput = document.getElementById('import-new-tag-input');
    const importAddTagBtn = document.getElementById('import-add-tag-btn');
    const importActiveTagsContainer = document.getElementById('import-active-tags');
    const importSuggestedTagsContainer = document.getElementById('import-suggested-tags');

    const confirmUploadBtn = document.getElementById('confirm-upload-btn');
    const cancelImportBtn = document.getElementById('cancel-import-btn');
    
    let pendingUploadFile = null;
    let importTempTags = [];

    // Import Modal Tag Functions
    function renderImportTags() {
        importActiveTagsContainer.innerHTML = '';
        importTempTags.forEach((tag, index) => {
            const pill = document.createElement('div');
            pill.className = 'tag-pill';
            pill.innerHTML = `
                ${tag} 
                <span class="remove-import-tag" data-index="${index}"><i class="fas fa-times"></i></span>
            `;
            importActiveTagsContainer.appendChild(pill);
        });

        document.querySelectorAll('.remove-import-tag').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                importTempTags.splice(idx, 1);
                renderImportTags();
                renderImportSuggestedTags();
            });
        });
    }

    function renderImportSuggestedTags() {
        if (!importSuggestedTagsContainer) return;
        importSuggestedTagsContainer.innerHTML = '';
        
        const defaultTags = ['文学', '社科', '自我成长', '计算机'];
        // Combine default tags with existing library tags
        const allPotentialTags = new Set([...defaultTags, ...allLibraryTags]);
        const sortedTags = Array.from(allPotentialTags).sort();
        
        sortedTags.forEach(tag => {
            if (!importTempTags.includes(tag)) {
                const pill = document.createElement('div');
                pill.className = 'suggested-tag';
                pill.innerText = tag;
                pill.addEventListener('click', () => {
                    importTempTags.push(tag);
                    renderImportTags();
                    renderImportSuggestedTags();
                });
                importSuggestedTagsContainer.appendChild(pill);
            }
        });

        if (importSuggestedTagsContainer.children.length === 0) {
            importSuggestedTagsContainer.innerHTML = '<span style="color:var(--text-muted); font-size: 0.9rem;">No other suggestions available.</span>';
        }
    }

    if (importAddTagBtn) {
        importAddTagBtn.addEventListener('click', () => {
            const tag = importNewTagInput.value.trim();
            if (tag && !importTempTags.includes(tag)) {
                importTempTags.push(tag);
                importNewTagInput.value = '';
                renderImportTags();
                renderImportSuggestedTags();
            }
        });
        
        importNewTagInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                importAddTagBtn.click();
            }
        });
    }

    if (importBtn && fileInput) {
        importBtn.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', () => {
            const file = fileInput.files[0];
            if (!file) return;

            pendingUploadFile = file;
            
            // Collect all existing tags from the library (refresh logic)
            allLibraryTags = new Set();
            booksData.forEach(b => {
                if (b.subjects) b.subjects.forEach(t => allLibraryTags.add(t));
            });
            
            // Reset state
            importTempTags = [];

            // Show Import Options Modal
            if (importOptionsModal) {
                importFilename.innerText = file.name;
                importNewTagInput.value = '';
                
                renderImportTags();
                renderImportSuggestedTags();
                
                importOptionsModal.classList.add('show');
                importNewTagInput.focus();
            }
        });
        
        if (confirmUploadBtn) {
            confirmUploadBtn.addEventListener('click', async () => {
                if (!pendingUploadFile) return;

                // Close Options Modal
                importOptionsModal.classList.remove('show');

                // Start Upload Process
                uploadLogs.innerText = '';
                uploadStatus.innerText = 'Starting upload...';
                closeModal.style.display = 'none';
                uploadModal.classList.add('show');

                const formData = new FormData();
                formData.append('file', pendingUploadFile);
                
                // Append categories
                importTempTags.forEach(tag => {
                    formData.append('categories', tag);
                });

                try {
                    const response = await fetch('/api/upload', {
                        method: 'POST',
                        body: formData
                    });

                    const result = await response.json();
                    
                    if (result.logs) {
                        uploadLogs.innerText = result.logs.join('\n');
                    }

                    if (result.success) {
                        uploadStatus.innerText = 'Import Successful!';
                        closeModal.style.display = 'block';
                        loadBooks(); // Refresh library
                    } else {
                        uploadStatus.innerText = 'Import Failed: ' + (result.error || 'Unknown error');
                        closeModal.style.display = 'block';
                    }
                } catch (error) {
                    uploadStatus.innerText = 'Network Error';
                    uploadLogs.innerText += '\n' + error.message;
                    closeModal.style.display = 'block';
                }
                
                // Cleanup
                fileInput.value = '';
                pendingUploadFile = null;
                importTempTags = [];
            });
        }
        
        if (cancelImportBtn) {
            cancelImportBtn.addEventListener('click', () => {
                importOptionsModal.classList.remove('show');
                fileInput.value = '';
                pendingUploadFile = null;
                importTempTags = [];
            });
        }

        closeModal.addEventListener('click', () => {
            uploadModal.classList.remove('show');
        });
    }


    function updateThemeIcon(isDark) {
        themeToggle.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    }

    // --- Delete Book Logic ---
    async function deleteBook(bookDir) {
        try {
            const response = await fetch(`/api/books/${encodeURIComponent(bookDir)}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                alert('Book deleted successfully!');
                loadBooks(); // Refresh the list
            } else {
                const errorData = await response.json();
                alert(`Failed to delete book: ${errorData.error || response.statusText}`);
            }
        } catch (error) {
            console.error('Error deleting book:', error);
            alert('An error occurred while trying to delete the book.');
        }
    }

    // Initialize
    loadBooks();
});
