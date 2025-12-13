document.addEventListener('DOMContentLoaded', async () => {
    const t = window.I18N?.t
        ? window.I18N.t
        : (key, vars) => {
            if (!vars) return key;
            return String(key).replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? '' : String(vars[k])));
        };

    // --- Helper: Fetch Asset (Server) ---
    async function fetchAsset(url) {
        return fetch(url);
    }

    const params = new URLSearchParams(window.location.search);
    const bookDir = params.get('book');
    
    if (!bookDir) {
        alert(t('reader.no_book_specified'));
        window.location.href = 'index.html';
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
	    const TOAST_DURATION_MS = 2000;
	    const PROGRESS_VERSION = 3;
	    const READING_BLOCK_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, dt, dd';
	    const AUTO_ANCHOR_PREFIX = '__epub_auto_';

	    let toastTimer = null;
	    function showToast(message) {
	        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add('show');
        if (toastTimer) window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => toast.classList.remove('show'), TOAST_DURATION_MS);
    }

	    function normalizeBookPath(path) {
	        if (!path) return path;
	        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return path;

        const [pathPart, hashPart] = path.split('#');
        const absolute = pathPart.startsWith('/');
        const parts = pathPart.split('/');
        const stack = [];

        for (const part of parts) {
            if (!part || part === '.') continue;
            if (part === '..') {
                if (stack.length > 0) stack.pop();
                continue;
            }
            stack.push(part);
        }

	        const normalized = (absolute ? '/' : '') + stack.join('/');
	        return (normalized.startsWith('/') ? normalized.slice(1) : normalized) + (hashPart ? `#${hashPart}` : '');
	    }

	    function readProgress() {
	        let raw = null;
	        try {
	            raw = localStorage.getItem(BOOK_KEY);
	        } catch {
	            return null;
	        }
	        if (!raw) return null;
	
	        // Backward-compat: previously stored as plain href string.
	        if (!raw.trim().startsWith('{')) {
	            const normalized = normalizeBookPath(raw);
	            const [filePath, anchor] = String(normalized).split('#');
	            return {
	                v: 1,
	                href: filePath,
	                anchor: anchor || null,
	                percent: null,
	                updatedAt: null,
	                chapterTitle: null,
	                spineIndex: null
	            };
	        }
	
	        try {
	            const parsed = JSON.parse(raw);
	            if (!parsed || typeof parsed !== 'object') return null;
	            if (!parsed.href || typeof parsed.href !== 'string') return null;
	
	            let updatedAt = null;
	            if (typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)) {
	                // If a timestamp is in seconds, convert to ms.
	                updatedAt = parsed.updatedAt < 1e12 ? parsed.updatedAt * 1000 : parsed.updatedAt;
	            }

	            return {
	                v: typeof parsed.v === 'number' ? parsed.v : PROGRESS_VERSION,
	                href: normalizeBookPath(parsed.href).split('#')[0],
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
	
	    function writeProgress(patch) {
	        if (!patch || !patch.href) return;
	        const nextHref = normalizeBookPath(patch.href).split('#')[0];
	        const existing = readProgress();
	
	        const next = {
	            v: PROGRESS_VERSION,
	            href: nextHref,
	            anchor: null,
	            percent: null
	            ,
	            updatedAt: existing ? existing.updatedAt : null,
	            chapterTitle: null,
	            spineIndex: null
	        };
	
	        if (existing && existing.href === nextHref) {
	            next.anchor = existing.anchor;
	            next.percent = existing.percent;
	            next.chapterTitle = existing.chapterTitle;
	            next.spineIndex = existing.spineIndex;
	        } else {
	            next.percent = 0;
	        }
	
	        if (typeof patch.anchor === 'string') next.anchor = patch.anchor || null;
	        if (typeof patch.percent === 'number' && Number.isFinite(patch.percent)) {
	            next.percent = Math.max(0, Math.min(1, patch.percent));
	        }
	        if (typeof patch.updatedAt === 'number' && Number.isFinite(patch.updatedAt)) {
	            next.updatedAt = patch.updatedAt < 1e12 ? patch.updatedAt * 1000 : patch.updatedAt;
	        }
	        if (typeof patch.chapterTitle === 'string') next.chapterTitle = patch.chapterTitle.trim() || null;
	        if (typeof patch.spineIndex === 'number' && Number.isFinite(patch.spineIndex)) next.spineIndex = patch.spineIndex;
	
	        try {
	            localStorage.setItem(BOOK_KEY, JSON.stringify(next));
	        } catch {}
	    }
	
	    function resolveBookHref(baseDir, href) {
	        if (!href) return href;
	        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return href;
        if (href.startsWith('#')) return null;
        const [hrefPath, hashPart] = href.split('#');
        const joined = hrefPath.startsWith('/') ? hrefPath : `${baseDir}/${hrefPath}`;
        const normalized = normalizeBookPath(joined);
        return normalized + (hashPart ? `#${hashPart}` : '');
    }

    tocContent.addEventListener('click', (e) => {
        const link = e.target.closest('a[data-src]');
        if (!link || !tocContent.contains(link)) return;
        const target = link.getAttribute('data-src');
        if (!target) return;
        e.preventDefault();
        loadChapter(target);
    });
    
	    // State
	    let spineItems = []; 
	    let currentSpineIndex = -1;
	    let currentChapterHref = null;
	    let bookMetadataLang = null;
	    let ncxPath = ''; 
	    let tocLoaded = false;
    
    // Settings State
    let currentFontSize = parseInt(localStorage.getItem('fontSize')) || 100;
    let currentTheme = localStorage.getItem('theme') || 'light';
    let currentMaxWidth = parseInt(localStorage.getItem('maxWidth')) || 800;
	    let currentFontProfile = localStorage.getItem('fontProfile') || 'serif';
	    let loadChapterRequestId = 0;
	    let transitionCleanupTimer = null;
	    let progressSaveTimer = null;
	    let isRestoringScrollPosition = false;
	
	    function ensureAutoAnchors(container) {
	        const blocks = Array.from(container.querySelectorAll(READING_BLOCK_SELECTOR));
	        blocks.forEach((el, idx) => {
	            if (el.id) return;
	            el.id = `${AUTO_ANCHOR_PREFIX}${idx}`;
	        });
	    }
	
	    function getReadingAnchorId() {
	        if (!scrollWrapper || !contentViewer) return null;
	        const rect = scrollWrapper.getBoundingClientRect();
	        const x = rect.left + rect.width / 2;
	        const y = rect.top + Math.min(80, Math.max(10, rect.height / 5));
	        const hit = document.elementFromPoint(x, y);
	        if (!hit || !contentViewer.contains(hit)) return null;
	
	        const block = typeof hit.closest === 'function' ? hit.closest(READING_BLOCK_SELECTOR) : null;
	        if (block && contentViewer.contains(block) && block.id) return block.id;
	
	        const withId = typeof hit.closest === 'function' ? hit.closest('[id]') : null;
	        if (withId && contentViewer.contains(withId) && withId.id) return withId.id;
	        return null;
	    }
	
	    function getScrollPercent() {
	        const max = scrollWrapper.scrollHeight - scrollWrapper.clientHeight;
	        if (max <= 0) return 0;
	        return Math.max(0, Math.min(1, scrollWrapper.scrollTop / max));
	    }
	
	    function saveReadingProgress({ updateLastReadAt = true } = {}) {
	        if (!currentChapterHref) return;
	        const patch = { href: currentChapterHref, percent: getScrollPercent() };
	        if (updateLastReadAt) patch.updatedAt = Date.now();
	        const anchorId = getReadingAnchorId();
	        if (anchorId) patch.anchor = anchorId;
	        writeProgress(patch);
	    }
	
	    function scheduleProgressSave(immediate = false, { updateLastReadAt = true } = {}) {
	        if (isRestoringScrollPosition) return;
	        if (progressSaveTimer) window.clearTimeout(progressSaveTimer);
	        if (immediate) {
	            saveReadingProgress({ updateLastReadAt });
	            return;
	        }
	        progressSaveTimer = window.setTimeout(() => saveReadingProgress({ updateLastReadAt }), 250);
	    }

	    function updateFontChangeTitle() {
	        const fontChangeBtn = document.getElementById('font-change');
	        if (!fontChangeBtn) return;
        fontChangeBtn.title = t('reader.change_font_current', { profile: currentFontProfile });
    }

    // --- 1. Load Book Data (Spine & TOC) ---
    async function loadToc() {
        try {
            tocLoaded = false;
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
                     tocLoaded = await loadNav(navPath);
                }
            }

            const spineRefs = Array.from(opfDoc.getElementsByTagName('itemref'));
            const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/'));
            spineItems = spineRefs.map(ref => {
                const id = ref.getAttribute('idref');
                const href = manifestItems[id];
                return { id: id, href: normalizeBookPath(`${opfDir}/${href}`) };
            });
            
            if (spineItems.length === 0) {
                contentViewer.innerHTML = `<p style="color:red; padding:20px;">${t('reader.no_chapters_error')}</p>`;
                return;
            }

            if (!tocLoaded && ncxPath) {
                tocLoaded = await loadNcx(ncxPath);
            }

	            // Restore Progress
	            const savedProgress = readProgress();
	            const savedLocation = savedProgress
	                ? normalizeBookPath(savedProgress.anchor ? `${savedProgress.href}#${savedProgress.anchor}` : savedProgress.href)
	                : null;
	            if (savedLocation) {
	                const filePath = savedLocation.split('#')[0];
	                const exists = spineItems.some(i => i.href === filePath);
	                loadChapter(exists ? savedLocation : spineItems[0].href, null, { restore: true, progress: savedProgress });
	            } else {
	                loadChapter(spineItems[0].href);
	            }

        } catch (e) {
            console.error(e);
            contentViewer.innerHTML = `<p style="padding:20px; color:red">${t('reader.error_loading_book', { message: e.message })}</p>`;
        }
    }

    async function loadNav(navPath) {
        try {
            const res = await fetchAsset(navPath);
            if (!res.ok) return false;
            const text = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, "text/html");
            
            const nav = doc.querySelector('nav[epub\\:type="toc"]') || doc.querySelector('nav');
            if (nav) {
                const baseDir = normalizeBookPath(navPath.substring(0, navPath.lastIndexOf('/')));
                nav.removeAttribute('hidden');
                nav.hidden = false;
                nav.removeAttribute('aria-hidden');

                let linkCount = 0;
                nav.querySelectorAll('a').forEach(a => {
                    const href = a.getAttribute('href');
                    const target = resolveBookHref(baseDir, href);
                    if (target) {
                        linkCount += 1;
                        a.setAttribute('data-src', target);
                        a.href = '#';
                    }
                });

                if (linkCount === 0) return false;
                tocContent.innerHTML = '';
                // Import node to ensure it belongs to the current document
                const importedNav = document.importNode(nav, true);
                tocContent.appendChild(importedNav);
                return true;
            }
            return false;
        } catch (e) {
            console.warn("Failed to load NAV", e);
            return false;
        }
    }

    async function loadNcx(path) {
        try {
            const res = await fetchAsset(path);
            if (!res.ok) return false;
            const text = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, "text/xml");
            const navMap = doc.getElementsByTagName('navMap')[0];
            if (!navMap) return false;

            const list = document.createElement('ul');
            const baseDir = normalizeBookPath(path.substring(0, path.lastIndexOf('/')));

            function processNavPoint(point) {
                const label = point.getElementsByTagName('navLabel')[0].getElementsByTagName('text')[0].textContent;
                const content = point.getElementsByTagName('content')[0].getAttribute('src');
                const fullPath = resolveBookHref(baseDir, content);
                if (!fullPath) return null;

                const li = document.createElement('li');
                const a = document.createElement('a');
                a.textContent = label;
                a.href = '#';
                a.setAttribute('data-src', fullPath);
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
            return true;
        } catch(e) {
            console.warn("Error loading NCX", e);
            return false;
        }
    }

	    async function loadChapter(href, direction = null, options = null) {
	        if (!href) return;
	        const requestId = ++loadChapterRequestId;
	        const [filePath, anchor] = href.split('#');
	        const normalizedFilePath = normalizeBookPath(filePath);
	        const normalizedHref = anchor ? `${normalizedFilePath}#${anchor}` : normalizedFilePath;
	        const restoreProgress = options && options.restore ? (options.progress || readProgress()) : null;

	        currentSpineIndex = spineItems.findIndex(i => i.href === normalizedFilePath);
	        currentChapterHref = normalizedFilePath;
	        
	        // Update Active TOC
	        document.querySelectorAll('.toc-content a').forEach(a => a.classList.remove('active'));
        const activeLink =
            document.querySelector(`.toc-content a[data-src="${normalizedHref}"]`) ||
            document.querySelector(`.toc-content a[data-src="${normalizedFilePath}"]`) ||
            document.querySelector(`.toc-content a[data-src^="${normalizedFilePath}#"]`);
        if (activeLink) {
            activeLink.classList.add('active');
            activeLink.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }

	        const shouldUpdateLastReadAt = !(options && options.restore);
	        writeProgress({
	            href: normalizedFilePath,
	            chapterTitle: activeLink ? activeLink.textContent : null,
	            spineIndex: currentSpineIndex,
	            updatedAt: shouldUpdateLastReadAt ? Date.now() : undefined
	        });

        try {
            if (transitionCleanupTimer) window.clearTimeout(transitionCleanupTimer);
            contentViewer.classList.remove('slide-out-left', 'slide-out-right', 'slide-in-left', 'slide-in-right');
            contentViewer.style.opacity = '1';

            // Animation: Exit Phase
            if (direction) {
                const exitClass = direction === 'next' ? 'slide-out-left' : 'slide-out-right';
                contentViewer.classList.add(exitClass);
            } else {
                contentViewer.style.opacity = '0.5'; // Fallback for jumps
            }

            const fetchPromise = fetchAsset(normalizedFilePath);
            // Wait for at least the animation duration if direction is set
            const animationPromise = direction ? new Promise(r => setTimeout(r, 200)) : Promise.resolve();

            const [response] = await Promise.all([fetchPromise, animationPromise]);
            if (requestId !== loadChapterRequestId) return;

            if (!response.ok) throw new Error(`Status: ${response.status}`);
            
            const htmlText = await response.text();
            if (requestId !== loadChapterRequestId) return;
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlText, 'text/html');
            
            await resolveAssetPaths(doc, normalizedFilePath);
            if (requestId !== loadChapterRequestId) return;
            
            const docLang = doc.documentElement.getAttribute('lang') || bookMetadataLang;
	            if (docLang) contentViewer.setAttribute('lang', docLang);

	            // Swap Content
	            contentViewer.innerHTML = doc.body.innerHTML;
	            ensureAutoAnchors(contentViewer);
            
            // Animation: Cleanup Exit & Start Enter Phase
            if (direction) {
                contentViewer.classList.remove('slide-out-left', 'slide-out-right');
                
                const enterClass = direction === 'next' ? 'slide-in-right' : 'slide-in-left';
                contentViewer.classList.add(enterClass);
                
                // Remove enter class after animation finishes
                transitionCleanupTimer = window.setTimeout(() => {
                    if (requestId !== loadChapterRequestId) return;
                    contentViewer.classList.remove(enterClass);
                }, 200);
            } else {
                 contentViewer.style.opacity = '1';
            }
            
            setupInteractions(contentViewer, normalizedFilePath);
            optimizeContentImages(contentViewer);
            enhanceCodeBlocks(contentViewer);
            applySettings();

            const withInstantScroll = (fn) => {
                const prev = scrollWrapper.style.getPropertyValue('scroll-behavior');
                const prevPriority = scrollWrapper.style.getPropertyPriority('scroll-behavior');
                scrollWrapper.style.setProperty('scroll-behavior', 'auto', 'important');
                try {
                    fn();
                } finally {
                    // Ensure the scroll action has applied before restoring smooth behavior.
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            if (prev) scrollWrapper.style.setProperty('scroll-behavior', prev, prevPriority || '');
                            else scrollWrapper.style.removeProperty('scroll-behavior');
                        });
                    });
                }
            };

	            const jumpToChapterStart = () => {
	                withInstantScroll(() => {
	                    if (typeof scrollWrapper.scrollTo === 'function') scrollWrapper.scrollTo(0, 0);
	                    else scrollWrapper.scrollTop = 0;
	                });
	            };
	
	            const jumpToPercent = (percent) => {
	                const clamped = Math.max(0, Math.min(1, percent));
	                withInstantScroll(() => {
	                    const max = scrollWrapper.scrollHeight - scrollWrapper.clientHeight;
	                    const target = max > 0 ? clamped * max : 0;
	                    if (typeof scrollWrapper.scrollTo === 'function') scrollWrapper.scrollTo(0, target);
	                    else scrollWrapper.scrollTop = target;
	                });
	            };
	
	            const restoreScroll = (fn) => {
	                isRestoringScrollPosition = true;
	                try {
	                    fn();
	                } finally {
	                    requestAnimationFrame(() => {
	                        requestAnimationFrame(() => {
	                            isRestoringScrollPosition = false;
	                            scheduleProgressSave(true, { updateLastReadAt: false });
	                        });
	                    });
	                }
	            };

	            if (anchor) {
	                setTimeout(() => {
	                    const targetEl = document.getElementById(anchor);
	                    if (targetEl) {
	                        restoreScroll(() => {
	                            withInstantScroll(() => {
	                                try {
	                                    targetEl.scrollIntoView({ block: 'start' });
	                                } catch {
	                                    targetEl.scrollIntoView();
	                                }
	                            });
	                        });
	                    } else {
	                        const canRestorePercent =
	                            restoreProgress &&
	                            restoreProgress.href === normalizedFilePath &&
	                            typeof restoreProgress.percent === 'number' &&
	                            Number.isFinite(restoreProgress.percent);
	                        if (canRestorePercent) restoreScroll(() => jumpToPercent(restoreProgress.percent));
	                        else restoreScroll(jumpToChapterStart);
	                    }
	                }, 0);
	            } else {
	                const canRestorePercent =
	                    restoreProgress &&
	                    restoreProgress.href === normalizedFilePath &&
	                    typeof restoreProgress.percent === 'number' &&
	                    Number.isFinite(restoreProgress.percent);
	                if (canRestorePercent) restoreScroll(() => jumpToPercent(restoreProgress.percent));
	                else restoreScroll(jumpToChapterStart);
	            }
	        } catch (e) {
	            if (requestId !== loadChapterRequestId) return;
            console.error(e);
            contentViewer.innerHTML = `<div style="padding:20px; color:red">${t('reader.error_generic', { message: e.message })}</div>`;
            if (direction) contentViewer.classList.remove('slide-out-left', 'slide-out-right');
            contentViewer.style.opacity = '1';
        } finally {
            if (requestId === loadChapterRequestId) updateButtons();
        }
    }

    async function resolveAssetPaths(doc, baseUrl) {
        const baseDir = baseUrl.substring(0, baseUrl.lastIndexOf('/'));
        
        const images = doc.querySelectorAll('img');
        for (const img of images) {
            const src = img.getAttribute('src');
            if (src && !src.startsWith('http') && !src.startsWith('/') && !src.startsWith('data:')) {
                const fullPath = resolveBookHref(baseDir, src) || `${baseDir}/${src}`;
                img.setAttribute('src', fullPath);
            }
            img.setAttribute('loading', 'lazy');
        }

        // SVG <image> can reference assets via href/xlink:href (common for cover pages)
        const svgImages = doc.querySelectorAll('svg image');
        for (const svgImage of svgImages) {
            const hrefAttr =
                svgImage.getAttribute('href') ||
                svgImage.getAttribute('xlink:href') ||
                svgImage.getAttributeNS('http://www.w3.org/1999/xlink', 'href');

            if (
                hrefAttr &&
                !hrefAttr.startsWith('http') &&
                !hrefAttr.startsWith('/') &&
                !hrefAttr.startsWith('data:')
            ) {
                const fullPath = resolveBookHref(baseDir, hrefAttr);
                if (!fullPath) continue;

                svgImage.setAttribute('href', fullPath);
                svgImage.setAttribute('xlink:href', fullPath);
                svgImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', fullPath);
            }
        }

        doc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
            const href = link.getAttribute('href');
            if (!href || href.startsWith('http') || href.startsWith('data:')) return;
            if (href.startsWith('/')) return;
            const fullPath = resolveBookHref(baseDir, href) || `${baseDir}/${href}`;
            link.setAttribute('href', fullPath);
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
        // Prevent "Wider Text" from becoming too wide on touch devices.
        const isTouchDevice = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
        const maxWidthCap = isTouchDevice ? 900 : Number.POSITIVE_INFINITY;
        if (currentMaxWidth > maxWidthCap) {
            currentMaxWidth = maxWidthCap;
            localStorage.setItem('maxWidth', currentMaxWidth);
        }

        contentViewer.style.fontSize = `${currentFontSize}%`;
        contentViewer.style.maxWidth = `${currentMaxWidth}px`;
        document.body.classList.toggle('dark-mode', currentTheme === 'dark');
        contentViewer.style.setProperty('--reader-font', getFontStack(currentFontProfile));
    }
    
	    function getFontStack(profile) {
	        const cjkSansFallback = [
	            '"PingFang TC"',
	            '"Hiragino Sans CNS"',
	            '"Heiti TC"',
	            '"Microsoft JhengHei"',
	            '"Noto Sans TC"',
	            '"Noto Sans CJK TC"',
	            '"Source Han Sans TC"',
	            '"Source Han Sans"'
	        ].join(', ');
	
	        const cjkSerifFallback = [
	            '"Songti TC"',
	            '"PMingLiU"',
	            '"MingLiU"',
	            '"Noto Serif TC"',
	            '"Noto Serif CJK TC"',
	            '"Source Han Serif TC"',
	            '"Source Han Serif"'
	        ].join(', ');
	
	        const stacks = {
	            'serif': `"Merriweather", ${cjkSerifFallback}, Georgia, "Times New Roman", Times, serif`,
	            'sans': `"Inter", ${cjkSansFallback}, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`,
	            'mono': '"Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
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

    // Mobile Settings Toggle
    const settingsToggle = document.getElementById('mobile-settings-toggle');
    const settingsGroup = document.getElementById('reader-settings');
    if (settingsToggle && settingsGroup) {
        settingsToggle.onclick = (e) => {
            e.stopPropagation();
            settingsGroup.classList.toggle('show');
        };
        document.addEventListener('click', (e) => {
            if (settingsGroup.classList.contains('show') && 
                !settingsGroup.contains(e.target) && 
                !settingsToggle.contains(e.target)) {
                settingsGroup.classList.remove('show');
            }
        });
    }

    prevBtn.onclick = () => {
        if (currentSpineIndex > 0) loadChapter(spineItems[currentSpineIndex - 1].href, 'prev');
    };

    nextBtn.onclick = () => {
        if (currentSpineIndex < spineItems.length - 1) loadChapter(spineItems[currentSpineIndex + 1].href, 'next');
    };

    // Keyboard Navigation (Desktop)
    document.addEventListener('keydown', (e) => {
        if (e.defaultPrevented) return;
        if (e.isComposing) return;
        if (e.altKey || e.ctrlKey || e.metaKey) return;

        const target = e.target;
        const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
        const isEditable =
            tag === 'input' ||
            tag === 'textarea' ||
            tag === 'select' ||
            (target && target.isContentEditable);
        if (isEditable) return;

        if (e.key === 'ArrowLeft') {
            if (!prevBtn.disabled) {
                e.preventDefault();
                prevBtn.click();
            }
        } else if (e.key === 'ArrowRight') {
            if (!nextBtn.disabled) {
                e.preventDefault();
                nextBtn.click();
            }
        }
    });

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

    const MIN_MAX_WIDTH = 420;
    const MAX_MAX_WIDTH = 1400;
    const TOUCH_MAX_MAX_WIDTH = 900;
    const WIDTH_STEP = 80;
    function getMaxWidthCap() {
        const isTouchDevice = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
        return isTouchDevice ? TOUCH_MAX_MAX_WIDTH : MAX_MAX_WIDTH;
    }

    const marginIncreaseBtn = document.getElementById('margin-increase');
    if (marginIncreaseBtn) {
        marginIncreaseBtn.onclick = () => {
            currentMaxWidth = Math.max(MIN_MAX_WIDTH, currentMaxWidth - WIDTH_STEP);
            localStorage.setItem('maxWidth', currentMaxWidth);
            showToast(t('reader.width_toast', { px: currentMaxWidth }));
            applySettings();
        };
    }

    const marginDecreaseBtn = document.getElementById('margin-decrease');
    if (marginDecreaseBtn) {
        marginDecreaseBtn.onclick = () => {
            currentMaxWidth = Math.min(getMaxWidthCap(), currentMaxWidth + WIDTH_STEP);
            localStorage.setItem('maxWidth', currentMaxWidth);
            showToast(t('reader.width_toast', { px: currentMaxWidth }));
            applySettings();
        };
    }

    const fontProfiles = ['serif', 'sans', 'mono'];
    const fontChangeBtn = document.getElementById('font-change');
    if (fontChangeBtn) {
        fontChangeBtn.onclick = () => {
            const currentIndex = fontProfiles.indexOf(currentFontProfile);
            const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % fontProfiles.length;
            currentFontProfile = fontProfiles[nextIndex];
            localStorage.setItem('fontProfile', currentFontProfile);
            updateFontChangeTitle();
            showToast(t('reader.font_toast', { profile: currentFontProfile }));
            applySettings();
        };
        updateFontChangeTitle();
    }

	    // --- Touch / Swipe Support ---
	    let touchStartX = null;
	    let touchStartY = null;

    function hasActiveTextSelectionInContent() {
        const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;

        const anchorNode = sel.anchorNode;
        const focusNode = sel.focusNode;
        if (!anchorNode && !focusNode) return false;

        return (
            (anchorNode && contentViewer.contains(anchorNode)) ||
            (focusNode && contentViewer.contains(focusNode))
        );
    }

    scrollWrapper.addEventListener('touchstart', (e) => {
        // Ignore multi-touch (pinch/zoom) and avoid tracking swipe gesture.
        if (e.touches && e.touches.length > 1) {
            touchStartX = null;
            touchStartY = null;
            return;
        }

        // Avoid interfering with code block scrolling
        if (e.target.closest('pre')) {
            touchStartX = null;
            return;
        }
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    scrollWrapper.addEventListener('touchend', (e) => {
        if (touchStartX === null) return;

        // If the user is selecting text (highlight), do not treat this as a page swipe.
        if (hasActiveTextSelectionInContent()) {
            touchStartX = null;
            touchStartY = null;
            return;
        }

        const touchEndX = e.changedTouches[0].screenX;
        const touchEndY = e.changedTouches[0].screenY;
        
        handleSwipe(touchStartX, touchStartY, touchEndX, touchEndY);
        touchStartX = null; 
    }, { passive: true });

	    scrollWrapper.addEventListener('touchcancel', () => {
	        touchStartX = null;
	        touchStartY = null;
	    }, { passive: true });
	
	    // Persist reading position within long chapters
	    scrollWrapper.addEventListener('scroll', () => scheduleProgressSave(false, { updateLastReadAt: true }), { passive: true });
	    document.addEventListener('visibilitychange', () => {
	        if (document.visibilityState === 'hidden') scheduleProgressSave(true, { updateLastReadAt: true });
	    });
	    window.addEventListener('beforeunload', () => scheduleProgressSave(true, { updateLastReadAt: true }));

    function handleSwipe(startX, startY, endX, endY) {
        const diffX = endX - startX;
        const diffY = endY - startY;
        const threshold = 50; 

        if (Math.abs(diffX) > Math.abs(diffY)) { // Horizontal
            if (Math.abs(diffX) > threshold) {
                if (diffX > 0) {
                    // Swipe Right -> Previous
                    if (!prevBtn.disabled) prevBtn.click();
                } else {
                    // Swipe Left -> Next
                    if (!nextBtn.disabled) nextBtn.click();
                }
            }
        }
    }

    // Initial Load
    window.addEventListener('ui-language-changed', () => {
        updateFontChangeTitle();
    });
    applySettings();
    loadToc();
});
