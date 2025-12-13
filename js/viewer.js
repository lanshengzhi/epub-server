document.addEventListener('DOMContentLoaded', async () => {
    console.log("Viewer DOMContentLoaded. Checking DBManager:", window.DBManager);
    
    // Initialize DB Manager if available (PWA/Extension mode)
    const dbManager = window.DBManager ? new DBManager() : null;
    if (dbManager) {
        try {
            await dbManager.open();
            console.log('DB Manager initialized in Viewer');
        } catch (e) {
            console.warn('DB Manager failed to open:', e);
        }
    }

    // --- Helper: Fetch Asset (Server vs DB) ---
    async function fetchAsset(url) {
        // 1. Try DB first if available and URL looks like a book path
        if (dbManager) {
            let cleanPath = url;
            
            // Remove Origin
            if (cleanPath.startsWith(window.location.origin)) {
                cleanPath = cleanPath.substring(window.location.origin.length);
            }
            
            // Repeatedly remove leading slashes to be safe
            while (cleanPath.startsWith('/')) {
                cleanPath = cleanPath.substring(1);
            }

            // Remove "pwa/" prefix if present (common in extension structure)
            if (cleanPath.startsWith('pwa/')) {
                cleanPath = cleanPath.substring(4);
            }
            
            // Remove "books/" prefix if present
            if (cleanPath.startsWith('books/')) {
                 cleanPath = cleanPath.substring(6); 
            }
            
            cleanPath = decodeURIComponent(cleanPath);
            
            console.log(`[FetchAsset] Looking up DB Key: "${cleanPath}" (Original: "${url}")`);

            try {
                 const fileRecord = await dbManager.getFile(cleanPath);
                 if (fileRecord) {
                     const blob = fileRecord.content instanceof Blob 
                                  ? fileRecord.content 
                                  : new Blob([fileRecord.content], { type: fileRecord.mimeType || 'text/plain' });
                     
                     return new Response(blob, { status: 200, statusText: 'OK (DB)' });
                 } else {
                     console.warn(`[FetchAsset] Not Found in DB: "${cleanPath}"`);
                     // DEBUG: Dump first few keys to see what's wrong
                     try {
                         const tx = dbManager.db.transaction(['books_files'], 'readonly');
                         const store = tx.objectStore('books_files');
                         const req = store.getAllKeys(null, 5);
                         req.onsuccess = () => {
                             console.log("DEBUG: Sample keys in DB:", req.result);
                         };
                     } catch(e) { console.error("DEBUG Error", e); }
                 }
            } catch (e) {
                 console.warn(`[FetchAsset] DB Error for ${cleanPath}:`, e);
            }
        }

        // 2. Fallback to Network
        return fetch(url);
    }

    const params = new URLSearchParams(window.location.search);
    const bookDir = params.get('book');
    
    if (!bookDir) {
        alert('No book specified.');
        // In extension, closing tab might be better, or redirect
        if (!chrome.runtime?.id) window.location.href = 'index.html';
        return;
    }

    // UI Elements
    const sidebar = document.getElementById('sidebar');
    const tocContent = document.getElementById('toc-content');
    const contentViewer = document.getElementById('content-viewer');
    const scrollWrapper = document.getElementById('content-scroll-wrapper');
    const titleEl = document.getElementById('book-title');
    const prevBtn = document.getElementById('prev-chapter');
    const nextBtn = document.getElementById('next-chapter');
    
    // Config
    const BOOK_KEY = `progress_${bookDir}`;
    const THEME_KEY = 'theme';
    
    // State
    let spineItems = []; 
    let currentSpineIndex = -1;
    let bookMetadataLang = null;
    let ncxPath = ''; 
    
    // Settings State
    let currentFontSize = parseInt(localStorage.getItem('fontSize')) || 100;
    let currentTheme = localStorage.getItem('theme') || 'light';
    let currentMaxWidth = parseInt(localStorage.getItem('maxWidth')) || 800;
    let currentFontProfile = localStorage.getItem('fontProfile') || 'serif';

    // --- 1. Load Book Data (Spine & TOC) ---
    async function loadToc() {
        try {
            // Step 1: Find OPF
            const containerRes = await fetchAsset(`${bookDir}/META-INF/container.xml`);
            if (!containerRes.ok) throw new Error('Could not load container.xml');
            const containerXml = await containerRes.text();
            
            const parser = new DOMParser();
            const containerDoc = parser.parseFromString(containerXml, "text/xml");
            const rootFile = containerDoc.getElementsByTagName('rootfile')[0];
            if(!rootFile) throw new Error('Invalid container.xml: No rootfile');
            
            const rootPath = rootFile.getAttribute('full-path');
            const opfPath = `${bookDir}/${rootPath}`;
            
            // Step 2: Load OPF
            const opfRes = await fetchAsset(opfPath);
            if (!opfRes.ok) throw new Error(`Could not load OPF: ${opfPath}`);
            const opfXml = await opfRes.text();
            const opfDoc = parser.parseFromString(opfXml, "text/xml");

            // Metadata
            const titleMeta = opfDoc.getElementsByTagName('dc:title')[0];
            if (titleMeta) titleEl.textContent = titleMeta.textContent;

            const langMeta = opfDoc.getElementsByTagName('dc:language')[0];
            if (langMeta) bookMetadataLang = langMeta.textContent;

            // Step 3: Parse Manifest & Spine
            const manifestItems = {};
            const items = Array.from(opfDoc.getElementsByTagName('item'));
            for (const item of items) {
                manifestItems[item.getAttribute('id')] = item.getAttribute('href');
                if (item.getAttribute('media-type') === 'application/x-dtbncx+xml') {
                    const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/'));
                    ncxPath = `${opfDir}/${item.getAttribute('href')}`;
                }
                if (item.getAttribute('properties') === 'nav') {
                     const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/'));
                     const navPath = `${opfDir}/${item.getAttribute('href')}`;
                     await loadNav(navPath);
                }
            }

            const spineRefs = Array.from(opfDoc.getElementsByTagName('itemref'));
            const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/'));
            spineItems = spineRefs.map(ref => {
                const id = ref.getAttribute('idref');
                const href = manifestItems[id];
                return { id: id, href: `${opfDir}/${href}` };
            });
            
            if (spineItems.length === 0) {
                contentViewer.innerHTML = '<p style="color:red; padding:20px;">Error: No chapters found.</p>';
                return;
            }

            if (!document.getElementById('toc-content').hasChildNodes() && ncxPath) {
                loadNcx(ncxPath);
            }

            // Restore Progress
            const savedProgress = localStorage.getItem(BOOK_KEY);
            if (savedProgress) {
                const exists = spineItems.some(i => savedProgress.startsWith(i.href));
                loadChapter(exists ? savedProgress : spineItems[0].href);
            } else {
                loadChapter(spineItems[0].href);
            }

        } catch (e) {
            console.error(e);
            contentViewer.innerHTML = `<p style="padding:20px; color:red">Error loading book: ${e.message}</p>`;
        }
    }

    async function loadNav(navPath) {
        try {
            const res = await fetchAsset(navPath);
            if (!res.ok) return;
            const text = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, "text/html");
            
            const nav = doc.querySelector('nav[epub\\:type="toc"]') || doc.querySelector('nav');
            if (nav) {
                const baseDir = navPath.substring(0, navPath.lastIndexOf('/'));
                nav.querySelectorAll('a').forEach(a => {
                    const href = a.getAttribute('href');
                    if (href) {
                        a.setAttribute('data-src', `${baseDir}/${href}`);
                        a.href = '#';
                        a.onclick = (e) => { e.preventDefault(); loadChapter(`${baseDir}/${href}`); };
                    }
                });
                tocContent.innerHTML = '';
                // Import node to ensure it belongs to the current document
                const importedNav = document.importNode(nav, true);
                tocContent.appendChild(importedNav);
            }
        } catch (e) { console.warn("Failed to load NAV", e); }
    }

    async function loadNcx(path) {
        try {
            const res = await fetchAsset(path);
            if (!res.ok) return;
            const text = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, "text/xml");
            const navMap = doc.getElementsByTagName('navMap')[0];
            if (!navMap) return;

            const list = document.createElement('ul');
            const baseDir = path.substring(0, path.lastIndexOf('/'));

            function processNavPoint(point) {
                const label = point.getElementsByTagName('navLabel')[0].getElementsByTagName('text')[0].textContent;
                const content = point.getElementsByTagName('content')[0].getAttribute('src');
                const fullPath = `${baseDir}/${content}`;

                const li = document.createElement('li');
                const a = document.createElement('a');
                a.textContent = label;
                a.href = '#';
                a.setAttribute('data-src', fullPath);
                a.onclick = (e) => { e.preventDefault(); loadChapter(fullPath); };
                li.appendChild(a);
                
                const children = Array.from(point.children).filter(c => c.nodeName.endsWith('navPoint'));
                if (children.length > 0) {
                    const subList = document.createElement('ul');
                    children.forEach(child => { const subLi = processNavPoint(child); if(subLi) subList.appendChild(subLi); });
                    li.appendChild(subList);
                }
                return li;
            }

            Array.from(navMap.children).forEach(child => {
                if (child.nodeName.endsWith('navPoint')) {
                    const li = processNavPoint(child);
                    if (li) list.appendChild(li);
                }
            });
            tocContent.innerHTML = '';
            tocContent.appendChild(list);
            
            const docTitle = doc.getElementsByTagName('docTitle')[0];
            if(docTitle) titleEl.textContent = docTitle.textContent.trim();
        } catch(e) { console.warn("Error loading NCX", e); }
    }

    async function loadChapter(href) {
        if (!href) return;
        const [filePath, anchor] = href.split('#');
        localStorage.setItem(BOOK_KEY, href);
        currentSpineIndex = spineItems.findIndex(i => i.href === filePath);
        
        // Update Active TOC
        document.querySelectorAll('.toc-content a').forEach(a => a.classList.remove('active'));
        const activeLink = document.querySelector(`.toc-content a[data-src="${filePath}"]`);
        if (activeLink) {
            activeLink.classList.add('active');
            activeLink.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }

        try {
            contentViewer.style.opacity = '0.5'; 
            const response = await fetchAsset(filePath);
            if (!response.ok) throw new Error(`Status: ${response.status}`);
            
            const htmlText = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlText, 'text/html');
            
            await resolveAssetPaths(doc, filePath);
            
            const docLang = doc.documentElement.getAttribute('lang') || bookMetadataLang;
            if (docLang) contentViewer.setAttribute('lang', docLang);

            contentViewer.innerHTML = doc.body.innerHTML;
            
            setupInteractions(contentViewer, filePath);
            optimizeContentImages(contentViewer);
            enhanceCodeBlocks(contentViewer);
            applySettings();

            if (anchor) {
                setTimeout(() => {
                    const targetEl = document.getElementById(anchor);
                    if (targetEl) targetEl.scrollIntoView();
                    else scrollWrapper.scrollTop = 0;
                }, 0);
            } else {
                scrollWrapper.scrollTop = 0;
            }
        } catch (e) {
            console.error(e);
            contentViewer.innerHTML = `<div style="padding:20px; color:red">Error: ${e.message}</div>`;
        } finally {
            contentViewer.style.opacity = '1';
            updateButtons();
        }
    }

    async function resolveAssetPaths(doc, baseUrl) {
        const baseDir = baseUrl.substring(0, baseUrl.lastIndexOf('/'));
        
        const images = doc.querySelectorAll('img');
        for (const img of images) {
            const src = img.getAttribute('src');
            if (src && !src.startsWith('http') && !src.startsWith('/') && !src.startsWith('data:')) {
                const fullPath = `${baseDir}/${src}`;
                if (dbManager) {
                     let dbPath = fullPath;
                     if (dbPath.startsWith('books/')) dbPath = decodeURIComponent(dbPath);
                     try {
                         const fileRecord = await dbManager.getFile(dbPath);
                         if (fileRecord) {
                             const blob = fileRecord.content instanceof Blob ? fileRecord.content : new Blob([fileRecord.content]);
                             img.setAttribute('src', URL.createObjectURL(blob));
                         } else {
                             img.setAttribute('src', fullPath);
                         }
                     } catch(e) { img.setAttribute('src', fullPath); }
                } else {
                    img.setAttribute('src', fullPath);
                }
            }
            img.setAttribute('loading', 'lazy');
        }

        doc.querySelectorAll('link[rel="stylesheet"]').forEach(async link => {
            const href = link.getAttribute('href');
            if (href && !href.startsWith('http')) {
                const fullPath = `${baseDir}/${href}`;
                if (dbManager) {
                    try {
                        const fileRecord = await dbManager.getFile(fullPath);
                         if (fileRecord) {
                             const text = await (new Response(fileRecord.content).text());
                             const style = document.createElement('style');
                             style.textContent = text;
                             link.parentNode.replaceChild(style, link);
                         }
                    } catch(e) {}
                } else {
                    link.setAttribute('href', fullPath);
                }
            }
        });
    }

    function setupInteractions(container, baseUrl) {
        const baseDir = baseUrl.substring(0, baseUrl.lastIndexOf('/'));
        container.querySelectorAll('a').forEach(a => {
            const href = a.getAttribute('href');
            if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('javascript:')) {
                a.onclick = (e) => {
                    e.preventDefault();
                    // Simple relative resolution
                    let target = href;
                    if(!href.startsWith('/')) target = `${baseDir}/${href}`;
                    loadChapter(target);
                };
            }
        });
    }

    function optimizeContentImages(container) {
        // Already handled in resolveAssetPaths mainly, but lightbox can go here
        container.querySelectorAll('img').forEach(img => {
            img.style.cursor = 'zoom-in';
            img.onclick = () => {
                // Simple Lightbox
                const overlay = document.createElement('div');
                overlay.style.position = 'fixed';
                overlay.style.top = '0'; overlay.style.left = '0';
                overlay.style.width = '100%'; overlay.style.height = '100%';
                overlay.style.background = 'rgba(0,0,0,0.9)';
                overlay.style.display = 'flex';
                overlay.style.alignItems = 'center';
                overlay.style.justifyContent = 'center';
                overlay.style.zIndex = '2000';
                overlay.onclick = () => document.body.removeChild(overlay);
                
                const clone = document.createElement('img');
                clone.src = img.src;
                clone.style.maxWidth = '90%';
                clone.style.maxHeight = '90%';
                clone.style.objectFit = 'contain';
                
                overlay.appendChild(clone);
                document.body.appendChild(overlay);
            };
        });
    }

    function enhanceCodeBlocks(container) {
        if (typeof hljs === 'undefined') return;
        container.querySelectorAll('pre code').forEach(block => {
            hljs.highlightElement(block);
        });
    }

    function applySettings() {
        contentViewer.style.fontSize = `${currentFontSize}%`;
        contentViewer.style.maxWidth = `${currentMaxWidth}px`;
        document.body.classList.toggle('dark-mode', currentTheme === 'dark');
        contentViewer.style.fontFamily = getFontStack(currentFontProfile);
    }
    
    function getFontStack(profile) {
        const stacks = {
            'serif': '"Merriweather", "Georgia", serif',
            'sans': '"Inter", "Helvetica", sans-serif',
            'mono': '"Fira Code", "Courier New", monospace'
        };
        return stacks[profile] || stacks['serif'];
    }

    function updateButtons() {
        prevBtn.disabled = currentSpineIndex <= 0;
        nextBtn.disabled = currentSpineIndex >= spineItems.length - 1;
    }

    // --- Event Listeners ---
    document.getElementById('toggle-sidebar').onclick = () => {
        document.getElementById('sidebar').classList.toggle('open');
    };
    
    document.getElementById('close-sidebar').onclick = () => {
        document.getElementById('sidebar').classList.remove('open');
    };

    prevBtn.onclick = () => {
        if (currentSpineIndex > 0) loadChapter(spineItems[currentSpineIndex - 1].href);
    };

    nextBtn.onclick = () => {
        if (currentSpineIndex < spineItems.length - 1) loadChapter(spineItems[currentSpineIndex + 1].href);
    };

    document.getElementById('theme-toggle').onclick = () => {
        currentTheme = currentTheme === 'light' ? 'dark' : 'light';
        localStorage.setItem(THEME_KEY, currentTheme);
        applySettings();
    };
    
    document.getElementById('font-increase').onclick = () => {
        currentFontSize += 10;
        localStorage.setItem('fontSize', currentFontSize);
        applySettings();
    };
    
    document.getElementById('font-decrease').onclick = () => {
        currentFontSize = Math.max(50, currentFontSize - 10);
        localStorage.setItem('fontSize', currentFontSize);
        applySettings();
    };

    // Initial Load
    applySettings();
    loadToc();
});
