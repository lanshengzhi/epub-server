document.addEventListener('DOMContentLoaded', () => {
    const t = window.I18N?.t
        ? window.I18N.t
        : (key, vars) => {
            if (!vars) return key;
            return String(key).replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? '' : String(vars[k])));
        };

    const bookList = document.getElementById('book-list');
    const themeToggle = document.getElementById('theme-toggle');
    const importBtn = document.getElementById('import-btn');
    const fileInput = document.getElementById('file-input');
    const uploadModal = document.getElementById('upload-modal');
    const uploadLogs = document.getElementById('upload-logs');
    const closeModal = document.getElementById('close-modal');
    const uploadStatus = document.getElementById('upload-status');
    const uploadTitle = uploadModal ? (uploadModal.querySelector('[data-i18n="library.importing_book"]') || uploadModal.querySelector('h3')) : null;

    // Controls
    const sortSelect = document.getElementById('sort-select');
    const recentFirstToggle = document.getElementById('recent-first-toggle');
    const viewGridBtn = document.getElementById('view-grid');
    const viewListBtn = document.getElementById('view-list');
    const categoryList = document.getElementById('category-list');

    let booksData = [];
    let currentView = 'grid'; // 'grid' or 'list'
    let currentSort = 'title'; // 'title' or 'author'
    let currentCategory = 'all';
    const UNCATEGORIZED_KEY = '__uncategorized__';
    const VIEW_STORAGE_KEY = 'library_view';
    const RECENT_FIRST_STORAGE_KEY = 'library_recent_first';
    let recentFirst = true;
    let activeUploadTaskId = null;
    let uploadPollTimer = null;
    let uploadLogIndex = 0;
    let uploadConsoleStatus = '';
    let uploadConsoleLines = [];
    let uploadAwaitTimer = null;
    let uploadAwaitStartedAt = 0;

    function renderUploadConsole() {
        if (!uploadLogs) return;
        const shouldAutoScroll =
            uploadLogs.scrollTop + uploadLogs.clientHeight >= uploadLogs.scrollHeight - 24;
        const parts = [];
        if (uploadConsoleStatus) parts.push(uploadConsoleStatus, '');
        if (uploadConsoleLines.length > 0) parts.push(uploadConsoleLines.join('\n'));
        uploadLogs.innerText = parts.join('\n');
        if (shouldAutoScroll) uploadLogs.scrollTop = uploadLogs.scrollHeight;
    }

    function setUploadConsoleStatus(message) {
        uploadConsoleStatus = message || '';
        renderUploadConsole();
    }

    function appendUploadConsoleLines(lines) {
        if (!lines || lines.length === 0) return;
        uploadConsoleLines.push(...lines);
        renderUploadConsole();
    }

    function setUploadModalConsoleOnly(enabled) {
        if (uploadTitle) uploadTitle.style.display = enabled ? 'none' : '';
        if (uploadStatus) uploadStatus.style.display = enabled ? 'none' : '';
    }

    function stopAwaitServerResponse() {
        if (uploadAwaitTimer) {
            window.clearInterval(uploadAwaitTimer);
            uploadAwaitTimer = null;
        }
        uploadAwaitStartedAt = 0;
    }

    function startAwaitServerResponse() {
        if (uploadAwaitTimer) return;
        uploadAwaitStartedAt = Date.now();
        uploadAwaitTimer = window.setInterval(() => {
            const seconds = Math.floor((Date.now() - uploadAwaitStartedAt) / 1000);
            setUploadConsoleStatus(`${t('library.waiting_server')} ${seconds}s`);
        }, 400);
    }

    function normalizeView(view) {
        return view === 'list' ? 'list' : 'grid';
    }

    function applyViewUI() {
        document.documentElement.classList.toggle('library-view-list', currentView === 'list');
        document.documentElement.classList.toggle('library-view-grid', currentView === 'grid');

        if (viewGridBtn && viewListBtn) {
            viewGridBtn.classList.toggle('active', currentView === 'grid');
            viewListBtn.classList.toggle('active', currentView === 'list');
        }

        if (!bookList) return;
        bookList.classList.toggle('library-grid', currentView === 'grid');
        bookList.classList.toggle('library-list', currentView === 'list');
    }

    function setView(view, { persist = true, rerender = true } = {}) {
        const next = normalizeView(view);
        if (next === currentView) return;
        currentView = next;
        applyViewUI();

        if (persist) {
            try {
                localStorage.setItem(VIEW_STORAGE_KEY, currentView);
            } catch {}
        }

        if (rerender) updateDisplay();
    }

    // Restore view mode preference early (avoid rendering "no books" before loadBooks()).
    try {
        const storedView = localStorage.getItem(VIEW_STORAGE_KEY);
        currentView = normalizeView(storedView);
    } catch {}
    applyViewUI();

    function normalizeBooleanPref(value, fallback) {
        if (value === null || value === undefined) return fallback;
        const normalized = String(value).trim().toLowerCase();
        if (!normalized) return fallback;
        if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
        if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
        return fallback;
    }

    try {
        recentFirst = normalizeBooleanPref(localStorage.getItem(RECENT_FIRST_STORAGE_KEY), true);
    } catch {}
    if (recentFirstToggle) recentFirstToggle.checked = recentFirst;

    function readBookProgress(bookDir) {
        if (!bookDir) return null;
        const key = `progress_${bookDir}`;
        let raw = null;
        try {
            raw = localStorage.getItem(key);
        } catch {
            return null;
        }
        if (!raw) return null;
        const trimmed = String(raw).trim();
        if (!trimmed.startsWith('{')) {
            return {
                href: trimmed,
                anchor: null,
                percent: null,
                updatedAt: null,
                chapterTitle: null,
                spineIndex: null
            };
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (!parsed || typeof parsed !== 'object') return null;

            let updatedAt = null;
            if (typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)) {
                updatedAt = parsed.updatedAt < 1e12 ? parsed.updatedAt * 1000 : parsed.updatedAt;
            }

            return {
                href: typeof parsed.href === 'string' ? parsed.href : null,
                anchor: typeof parsed.anchor === 'string' && parsed.anchor ? parsed.anchor : null,
                percent: typeof parsed.percent === 'number' && Number.isFinite(parsed.percent) ? parsed.percent : null,
                updatedAt,
                chapterTitle: typeof parsed.chapterTitle === 'string' && parsed.chapterTitle.trim() ? parsed.chapterTitle.trim() : null,
                spineIndex: typeof parsed.spineIndex === 'number' && Number.isFinite(parsed.spineIndex) ? parsed.spineIndex : null
            };
        } catch {
            return null;
        }
    }

    function formatBookProgress(progress) {
        if (!progress) return '';
        const hasPercent = typeof progress.percent === 'number' && Number.isFinite(progress.percent);
        const percentInt = hasPercent ? Math.max(0, Math.min(100, Math.round(progress.percent * 100))) : null;
        const chapterTitle =
            progress.chapterTitle ||
            (typeof progress.spineIndex === 'number' && Number.isFinite(progress.spineIndex)
                ? t('library.reading_progress_chapter_index', { index: progress.spineIndex + 1 })
                : null);

        if (percentInt !== null && chapterTitle) {
            return t('library.reading_progress_percent_chapter', { percent: percentInt, chapter: chapterTitle });
        }
        if (percentInt !== null) {
            return t('library.reading_progress_percent', { percent: percentInt });
        }
        if (chapterTitle) {
            return t('library.reading_progress_chapter', { chapter: chapterTitle });
        }
        return '';
    }

    // Fetch and Render Books
    async function loadBooks() {
        if (window.location.protocol === 'file:') {
             bookList.innerHTML = `<p class="error">${t('library.file_protocol_error_html')}</p>`;
             return;
        }

        try {
            const response = await fetch('/api/books');
            if (!response.ok) throw new Error(t('library.failed_fetch_books', { status: response.statusText }));
            booksData = await response.json();
            updateCategories();
            updateDisplay();
        } catch (error) {
            console.error('Error loading books:', error);
            // Fallback to empty or error message
            bookList.innerHTML = `<p class="error">${t('library.could_not_load_prefix')}<br><small>${error.message}</small></p>`;
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
                categories[UNCATEGORIZED_KEY] = (categories[UNCATEGORIZED_KEY] || 0) + 1;
            }
        });

        // Clear list but keep "All Books" (re-render it to update count)
        categoryList.innerHTML = '';

        // Add "All Books"
        const allLi = document.createElement('li');
        allLi.className = currentCategory === 'all' ? 'active' : '';
        const allLabel = document.createElement('span');
        allLabel.textContent = t('library.all_books');
        const allCount = document.createElement('span');
        allCount.className = 'count';
        allCount.textContent = String(booksData.length);
        allLi.appendChild(allLabel);
        allLi.appendChild(allCount);
        allLi.addEventListener('click', () => {
            currentCategory = 'all';
            updateCategories(); // Re-render to update active class
            updateDisplay();
        });
        categoryList.appendChild(allLi);

        // Add other categories
        const sortedCategories = Object.keys(categories).sort((a, b) => {
            if (a === UNCATEGORIZED_KEY) return 1;
            if (b === UNCATEGORIZED_KEY) return -1;
            return a.localeCompare(b);
        });
        sortedCategories.forEach(cat => {
            const li = document.createElement('li');
            li.className = currentCategory === cat ? 'active' : '';
            const label = document.createElement('span');
            label.textContent = cat === UNCATEGORIZED_KEY ? t('library.uncategorized') : cat;
            const count = document.createElement('span');
            count.className = 'count';
            count.textContent = String(categories[cat]);
            li.appendChild(label);
            li.appendChild(count);
            li.addEventListener('click', () => {
                currentCategory = cat;
                updateCategories();
                updateDisplay();
            });
            categoryList.appendChild(li);
        });
    }

    function updateDisplay() {
        const progressCache = new Map();
        const getProgress = (bookDir) => {
            if (!bookDir) return null;
            if (progressCache.has(bookDir)) return progressCache.get(bookDir);
            const progress = readBookProgress(bookDir);
            progressCache.set(bookDir, progress);
            return progress;
        };
        const hasReadingRecord = (progress) => {
            if (!progress) return false;
            if (typeof progress.updatedAt === 'number' && Number.isFinite(progress.updatedAt)) return true;
            if (typeof progress.percent === 'number' && Number.isFinite(progress.percent)) return true;
            if (typeof progress.chapterTitle === 'string' && progress.chapterTitle.trim()) return true;
            if (typeof progress.spineIndex === 'number' && Number.isFinite(progress.spineIndex)) return true;
            return typeof progress.href === 'string' && progress.href.trim().length > 0;
        };

        // Filter
        let filteredBooks = booksData;
        if (currentCategory !== 'all') {
            if (currentCategory === UNCATEGORIZED_KEY) {
                filteredBooks = booksData.filter(b => !b.subjects || b.subjects.length === 0);
            } else {
                filteredBooks = booksData.filter(b => b.subjects && b.subjects.includes(currentCategory));
            }
        }

        // Sort
        const sortedBooks = [...filteredBooks].sort((a, b) => {
            if (recentFirst) {
                const pa = getProgress(a.dir);
                const pb = getProgress(b.dir);
                const ta = pa && typeof pa.updatedAt === 'number' && Number.isFinite(pa.updatedAt) ? pa.updatedAt : null;
                const tb = pb && typeof pb.updatedAt === 'number' && Number.isFinite(pb.updatedAt) ? pb.updatedAt : null;
                const ha = hasReadingRecord(pa);
                const hb = hasReadingRecord(pb);
                const hta = ta !== null;
                const htb = tb !== null;

                if (hta && htb && ta !== tb) return tb - ta;
                if (hta !== htb) return hta ? -1 : 1;
                if (ha !== hb) return ha ? -1 : 1;
            }

            const valA = (a[currentSort] || '').toString().toLowerCase();
            const valB = (b[currentSort] || '').toString().toLowerCase();
            const cmp = valA.localeCompare(valB);
            if (cmp !== 0) return cmp;
            return (a.dir || '').toString().localeCompare((b.dir || '').toString());
        });

        applyViewUI();

        renderBooks(sortedBooks, getProgress);
    }

    // Event Listeners for Controls
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            currentSort = e.target.value;
            updateDisplay();
        });
    }

    if (recentFirstToggle) {
        recentFirstToggle.addEventListener('change', () => {
            recentFirst = !!recentFirstToggle.checked;
            try {
                localStorage.setItem(RECENT_FIRST_STORAGE_KEY, recentFirst ? '1' : '0');
            } catch {}
            updateDisplay();
        });
    }

    if (viewGridBtn && viewListBtn) {
        viewGridBtn.addEventListener('click', () => {
            setView('grid');
        });

        viewListBtn.addEventListener('click', () => {
            setView('list');
        });
    }

    function renderBooks(books, getProgress) {
        bookList.innerHTML = '';
        if (books.length === 0) {
            bookList.innerHTML = `<p>${t('library.no_books_found')}</p>`;
            return;
        }

        books.forEach(book => {
            const progress = typeof getProgress === 'function' ? getProgress(book.dir) : readBookProgress(book.dir);
            const progressText = formatBookProgress(progress);
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
                    ${progressText ? `<p class="book-progress">${progressText}</p>` : ''}
                </div>
                <button class="edit-tags-btn" data-book-dir="${book.dir}" title="${t('library.edit_categories')}">
                    <i class="fas fa-tags"></i>
                </button>
                <button class="delete-btn" data-book-dir="${book.dir}" title="${t('library.delete_book')}">
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
                if (confirm(t('library.delete_confirm', { name: decodeURIComponent(bookDir) }))) {
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
            suggestedTagsContainer.innerHTML = `<span style="color:var(--text-muted); font-size: 0.9rem;">${t('library.no_other_existing_tags')}</span>`;
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
                    alert(t('library.failed_save_categories'));
                }
            } catch (e) {
                console.error(e);
                alert(t('library.error_save_categories'));
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
            importSuggestedTagsContainer.innerHTML = `<span style="color:var(--text-muted); font-size: 0.9rem;">${t('library.no_other_suggestions')}</span>`;
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
                importFilename.title = file.name;
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
                uploadConsoleLines = [];
                uploadConsoleStatus = '';
                setUploadModalConsoleOnly(true);
                setUploadConsoleStatus(t('library.importing_book'));
                closeModal.style.display = 'none';
                uploadModal.classList.add('show');

                const formData = new FormData();
                formData.append('file', pendingUploadFile);
                
                // Append categories
                importTempTags.forEach(tag => {
                    formData.append('categories', tag);
                });

                function stopUploadPolling() {
                    activeUploadTaskId = null;
                    uploadLogIndex = 0;
                    stopAwaitServerResponse();
                    if (uploadPollTimer) {
                        window.clearTimeout(uploadPollTimer);
                        uploadPollTimer = null;
                    }
                }

                async function pollUploadStatus(taskId) {
                    if (activeUploadTaskId !== taskId) return;

                    try {
                        const res = await fetch(`/api/upload-status/${encodeURIComponent(taskId)}?since=${uploadLogIndex}`);
                        if (!res.ok) throw new Error(`Status: ${res.status}`);
                        const data = await res.json();
                        if (activeUploadTaskId !== taskId) return;

                        if (Array.isArray(data.logs) && data.logs.length > 0) {
                            appendUploadConsoleLines(data.logs);
                            uploadLogIndex = typeof data.next_index === 'number' ? data.next_index : (uploadLogIndex + data.logs.length);
                        }

                        const phase = data.phase || 'processing';
                        const percent = typeof data.percent === 'number' ? data.percent : 0;
                        const current = typeof data.current === 'number' ? data.current : 0;
                        const total = typeof data.total === 'number' ? data.total : 0;
                        const progressText = total > 0 ? `${percent}% (${current}/${total})` : '';
                        setUploadConsoleStatus(`${t('library.uploading_and_processing')} ${phase} ${progressText}`.trim());

                        if (data.status === 'done') {
                            setUploadConsoleStatus(t('library.import_success'));
                            closeModal.style.display = 'block';
                            stopUploadPolling();
                            loadBooks(); // Refresh library
                            return;
                        }

                        if (data.status === 'error') {
                            setUploadConsoleStatus(t('library.import_failed', { error: data.error || t('library.unknown_error') }));
                            closeModal.style.display = 'block';
                            stopUploadPolling();
                            return;
                        }

                        uploadPollTimer = window.setTimeout(() => pollUploadStatus(taskId), 300);
                    } catch (error) {
                        appendUploadConsoleLines([`[poll error] ${error.message}`]);
                        uploadPollTimer = window.setTimeout(() => pollUploadStatus(taskId), 800);
                    }
                }

                stopUploadPolling();
                setUploadConsoleStatus(t('library.starting_upload'));

                try {
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', '/api/upload?async=1', true);
                    let uploadProgressReached100 = false;

                    xhr.upload.onprogress = (e) => {
                        if (!e.lengthComputable) return;
                        const percent = Math.floor((e.loaded / e.total) * 100);
                        setUploadConsoleStatus(`${t('library.uploading')} ${percent}%`);
                        if (percent >= 100 && !uploadProgressReached100) {
                            uploadProgressReached100 = true;
                            startAwaitServerResponse();
                        }
                    };

                    xhr.onerror = () => {
                        stopAwaitServerResponse();
                        setUploadConsoleStatus(t('library.network_error'));
                        appendUploadConsoleLines(['Upload failed (network error).']);
                        closeModal.style.display = 'block';
                    };

                    xhr.onload = () => {
                        stopAwaitServerResponse();
                        try {
                            const result = JSON.parse(xhr.responseText || '{}');

                            if (result.task_id) {
                                activeUploadTaskId = result.task_id;
                                uploadLogIndex = 0;
                                setUploadConsoleStatus(t('library.uploading_and_processing'));
                                pollUploadStatus(activeUploadTaskId);
                                return;
                            }

                            // Backward compatible path: old synchronous response.
                            if (result.logs) appendUploadConsoleLines(result.logs);
                            if (result.success) {
                                setUploadConsoleStatus(t('library.import_success'));
                                closeModal.style.display = 'block';
                                loadBooks();
                            } else {
                                setUploadConsoleStatus(t('library.import_failed', { error: result.error || t('library.unknown_error') }));
                                closeModal.style.display = 'block';
                            }
                        } catch (e) {
                            setUploadConsoleStatus(t('library.import_failed', { error: t('library.unknown_error') }));
                            appendUploadConsoleLines([e.message]);
                            closeModal.style.display = 'block';
                        }
                    };

                    xhr.send(formData);
                } catch (error) {
                    setUploadConsoleStatus(t('library.network_error'));
                    appendUploadConsoleLines([error.message]);
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
            activeUploadTaskId = null;
            uploadLogIndex = 0;
            stopAwaitServerResponse();
            if (uploadPollTimer) {
                window.clearTimeout(uploadPollTimer);
                uploadPollTimer = null;
            }
            setUploadModalConsoleOnly(false);
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
                alert(t('library.book_deleted'));
                loadBooks(); // Refresh the list
            } else {
                const errorData = await response.json();
                alert(t('library.failed_delete_book', { error: errorData.error || response.statusText }));
            }
        } catch (error) {
            console.error('Error deleting book:', error);
            alert(t('library.error_deleting_book'));
        }
    }

    // Initialize
    window.addEventListener('ui-language-changed', () => {
        updateCategories();
        updateDisplay();
    });
    window.addEventListener('pageshow', (event) => {
        if (!event.persisted) return;
        if (Array.isArray(booksData) && booksData.length > 0) {
            requestAnimationFrame(() => {
                updateCategories();
                updateDisplay();
            });
            return;
        }
        loadBooks();
    });
    loadBooks();
});
