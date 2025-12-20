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
    const backToLibraryLink = document.getElementById('back-to-library');
    const prevBtn = document.getElementById('prev-chapter');
    const nextBtn = document.getElementById('next-chapter');
    const toggleSidebarBtn = document.getElementById('toggle-sidebar');
    const closeSidebarBottomBtn = document.getElementById('close-sidebar-bottom');
    const sidebarBackdrop = document.getElementById('sidebar-backdrop');
    const toolbarTocBtn = document.getElementById('toolbar-toc');
    const toolbarThemeBtn = document.getElementById('toolbar-theme');
    const toolbarTypographyBtn = document.getElementById('toolbar-typography');
    const settingsSheet = document.getElementById('reader-settings-sheet');
    const toolbarBottom = document.querySelector('.reader-toolbar-bottom');
    const sheetFontDecreaseBtn = document.getElementById('sheet-font-decrease');
    const sheetFontIncreaseBtn = document.getElementById('sheet-font-increase');
    const sheetMarginIncreaseBtn = document.getElementById('sheet-margin-increase');
    const sheetMarginDecreaseBtn = document.getElementById('sheet-margin-decrease');
    const sheetLineHeightDecreaseBtn = document.getElementById('sheet-line-height-decrease');
    const sheetLineHeightIncreaseBtn = document.getElementById('sheet-line-height-increase');

    // Config
    const BOOK_KEY = `progress_${bookDir}`;
    const TOAST_DURATION_MS = 2000;
    const PROGRESS_VERSION = 3;
    const READING_BLOCK_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, dt, dd';
    const AUTO_ANCHOR_PREFIX = '__epub_auto_';

    let toastTimer = null;
    function showToast(message, durationMs = TOAST_DURATION_MS) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add('show');
        if (toastTimer) window.clearTimeout(toastTimer);
        const duration = Number(durationMs);
        const timeout = Number.isFinite(duration) ? Math.max(0, duration) : TOAST_DURATION_MS;
        toastTimer = window.setTimeout(() => toast.classList.remove('show'), timeout);
    }

    const sidebarOverlayQuery = typeof window.matchMedia === 'function'
        ? window.matchMedia('(max-width: 768px)')
        : null;

    function isSidebarOverlayMode() {
        if (sidebarOverlayQuery) return sidebarOverlayQuery.matches;
        return window.innerWidth <= 768;
    }

    function setSidebarOpen(isOpen) {
        if (!sidebar) return;
        sidebar.classList.toggle('open', isOpen);

        if (toggleSidebarBtn) {
            toggleSidebarBtn.setAttribute('aria-controls', 'sidebar');
            toggleSidebarBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        }

        sidebar.setAttribute('aria-hidden', isOpen ? 'false' : 'true');

        if (sidebarBackdrop) {
            sidebarBackdrop.classList.toggle('open', isOpen && isSidebarOverlayMode());
        }
    }

    let settingsOpen = false;

    function setSettingsOpen(isOpen) {
        settingsOpen = !!isOpen;
        const active = isSidebarOverlayMode();
        if (!active) settingsOpen = false;
        document.body.classList.toggle('settings-open', active && settingsOpen);
        if (settingsSheet) settingsSheet.setAttribute('aria-hidden', active && settingsOpen ? 'false' : 'true');
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

        const trimmed = raw.trim();
        if (!trimmed.startsWith('{')) return null;

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
        } catch { }
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
        if (isSidebarOverlayMode()) setSidebarOpen(false);
    });

    // State
    let spineItems = [];
    let currentSpineIndex = -1;
    let currentChapterHref = null;
    let bookMetadataLang = null;
    let ncxPath = '';
    let tocLoaded = false;

    // Reader Settings (separate profiles for desktop vs mobile)
    const READER_SETTINGS_VERSION = 1;
    const READER_PROFILE_DESKTOP = 'desktop';
    const READER_PROFILE_MOBILE = 'mobile';
    const READER_SETTINGS_STORAGE_PREFIX = `readerSettings_v${READER_SETTINGS_VERSION}_`;

    const READER_FONT_PROFILES = ['serif', 'sans', 'mono'];
    const READER_THEME_VALUES = ['light', 'dark'];

    const READER_SETTINGS_DEFAULTS = {
        [READER_PROFILE_DESKTOP]: {
            fontSize: 100,
            lineHeight: 1.8,
            maxWidth: 800,
            theme: 'light',
            fontProfile: 'serif'
        },
        [READER_PROFILE_MOBILE]: {
            fontSize: 110,
            lineHeight: 1.75,
            maxWidth: 700,
            theme: 'light',
            fontProfile: 'serif'
        }
    };

    const READER_SETTINGS_LIMITS = {
        [READER_PROFILE_DESKTOP]: {
            fontSize: { min: 60, max: 200, step: 10 },
            lineHeight: { min: 1.2, max: 2.4, step: 0.1 },
            maxWidth: { min: 420, max: 1400, step: 80 }
        },
        [READER_PROFILE_MOBILE]: {
            fontSize: { min: 70, max: 220, step: 10 },
            lineHeight: { min: 1.3, max: 2.6, step: 0.1 },
            maxWidth: { min: 320, max: 900, step: 80 }
        }
    };

    function getReaderProfileFromViewport() {
        return isSidebarOverlayMode() ? READER_PROFILE_MOBILE : READER_PROFILE_DESKTOP;
    }

    function getReaderSettingsStorageKey(profile) {
        const normalized = profile === READER_PROFILE_MOBILE ? READER_PROFILE_MOBILE : READER_PROFILE_DESKTOP;
        return `${READER_SETTINGS_STORAGE_PREFIX}${normalized}`;
    }

    function safeLocalStorageGet(key) {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    }

    function safeLocalStorageSet(key, value) {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch {
            return false;
        }
    }

    function clampNumber(value, min, max) {
        const n = Number(value);
        if (!Number.isFinite(n)) return null;
        return Math.max(min, Math.min(max, n));
    }

    function snapToStep(value, step) {
        const n = Number(value);
        const s = Number(step);
        if (!Number.isFinite(n) || !Number.isFinite(s) || s <= 0) return n;
        return Math.round(n / s) * s;
    }

    function normalizeTheme(value) {
        const v = String(value || '').trim().toLowerCase();
        return v === 'dark' ? 'dark' : 'light';
    }

    function normalizeFontProfile(value) {
        const v = String(value || '').trim().toLowerCase();
        return READER_FONT_PROFILES.includes(v) ? v : 'serif';
    }

    function normalizeReaderSettings(raw, profile) {
        const p = profile === READER_PROFILE_MOBILE ? READER_PROFILE_MOBILE : READER_PROFILE_DESKTOP;
        const defaults = READER_SETTINGS_DEFAULTS[p];
        const limits = READER_SETTINGS_LIMITS[p];

        const next = {
            fontSize: defaults.fontSize,
            lineHeight: defaults.lineHeight,
            maxWidth: defaults.maxWidth,
            theme: defaults.theme,
            fontProfile: defaults.fontProfile
        };

        if (raw && typeof raw === 'object') {
            const fs = clampNumber(raw.fontSize, limits.fontSize.min, limits.fontSize.max);
            if (fs !== null) next.fontSize = snapToStep(fs, limits.fontSize.step);

            const lh = clampNumber(raw.lineHeight, limits.lineHeight.min, limits.lineHeight.max);
            if (lh !== null) {
                const snapped = snapToStep(lh, limits.lineHeight.step);
                next.lineHeight = Math.round(snapped * 100) / 100;
            }

            const mw = clampNumber(raw.maxWidth, limits.maxWidth.min, limits.maxWidth.max);
            if (mw !== null) next.maxWidth = snapToStep(mw, limits.maxWidth.step);

            if (raw.theme !== undefined) next.theme = normalizeTheme(raw.theme);
            if (raw.fontProfile !== undefined) next.fontProfile = normalizeFontProfile(raw.fontProfile);
        }

        next.fontSize = Math.round(Number(next.fontSize));
        next.maxWidth = Math.round(Number(next.maxWidth));
        if (!Number.isFinite(next.lineHeight)) next.lineHeight = defaults.lineHeight;

        next.fontSize = Math.max(limits.fontSize.min, Math.min(limits.fontSize.max, next.fontSize));
        next.maxWidth = Math.max(limits.maxWidth.min, Math.min(limits.maxWidth.max, next.maxWidth));
        next.lineHeight = Math.max(limits.lineHeight.min, Math.min(limits.lineHeight.max, Number(next.lineHeight)));

        next.theme = READER_THEME_VALUES.includes(next.theme) ? next.theme : defaults.theme;
        next.fontProfile = READER_FONT_PROFILES.includes(next.fontProfile) ? next.fontProfile : defaults.fontProfile;

        return next;
    }

    function readReaderSettings(profile) {
        const key = getReaderSettingsStorageKey(profile);
        const raw = safeLocalStorageGet(key);
        if (!raw) return normalizeReaderSettings(null, profile);
        try {
            const parsed = JSON.parse(raw);
            return normalizeReaderSettings(parsed, profile);
        } catch {
            return normalizeReaderSettings(null, profile);
        }
    }

    function writeReaderSettings(profile, patch) {
        const current = readReaderSettings(profile);
        const merged = Object.assign({}, current, (patch && typeof patch === 'object') ? patch : {});
        const normalized = normalizeReaderSettings(merged, profile);
        safeLocalStorageSet(getReaderSettingsStorageKey(profile), JSON.stringify(normalized));
        return normalized;
    }

    function ensureReaderSettingsProfiles() {
        const desktopKey = getReaderSettingsStorageKey(READER_PROFILE_DESKTOP);
        const mobileKey = getReaderSettingsStorageKey(READER_PROFILE_MOBILE);

        const hasDesktop = !!safeLocalStorageGet(desktopKey);
        const hasMobile = !!safeLocalStorageGet(mobileKey);
        if (hasDesktop && hasMobile) return;

        if (!hasDesktop) {
            const base = Object.assign({}, READER_SETTINGS_DEFAULTS[READER_PROFILE_DESKTOP]);
            safeLocalStorageSet(desktopKey, JSON.stringify(normalizeReaderSettings(base, READER_PROFILE_DESKTOP)));
        }

        if (!hasMobile) {
            let base = Object.assign({}, READER_SETTINGS_DEFAULTS[READER_PROFILE_MOBILE]);
            if (hasDesktop) {
                base = Object.assign({}, READER_SETTINGS_DEFAULTS[READER_PROFILE_MOBILE], readReaderSettings(READER_PROFILE_DESKTOP));
            }
            safeLocalStorageSet(mobileKey, JSON.stringify(normalizeReaderSettings(base, READER_PROFILE_MOBILE)));
        }
    }

    function loadSettingsForProfile(profile) {
        ensureReaderSettingsProfiles();
        const settings = readReaderSettings(profile);
        currentFontSize = settings.fontSize;
        currentTheme = settings.theme;
        currentMaxWidth = settings.maxWidth;
        currentLineHeight = settings.lineHeight;
        currentFontProfile = settings.fontProfile;
        return settings;
    }

    function persistSettingsForCurrentProfile(patch) {
        const settings = writeReaderSettings(currentReaderProfile, patch);
        currentFontSize = settings.fontSize;
        currentTheme = settings.theme;
        currentMaxWidth = settings.maxWidth;
        currentLineHeight = settings.lineHeight;
        currentFontProfile = settings.fontProfile;
        return settings;
    }

    let currentReaderProfile = getReaderProfileFromViewport();

    // Settings State (derived from current profile)
    let currentFontSize = READER_SETTINGS_DEFAULTS[currentReaderProfile].fontSize;
    let currentTheme = READER_SETTINGS_DEFAULTS[currentReaderProfile].theme;
    let currentMaxWidth = READER_SETTINGS_DEFAULTS[currentReaderProfile].maxWidth;
    let currentLineHeight = READER_SETTINGS_DEFAULTS[currentReaderProfile].lineHeight;
    let currentFontProfile = READER_SETTINGS_DEFAULTS[currentReaderProfile].fontProfile;

    loadSettingsForProfile(currentReaderProfile);
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

    function withInstantScrollWrapper(fn) {
        if (!scrollWrapper) return;
        const prev = scrollWrapper.style.getPropertyValue('scroll-behavior');
        const prevPriority = scrollWrapper.style.getPropertyPriority('scroll-behavior');
        scrollWrapper.style.setProperty('scroll-behavior', 'auto', 'important');
        try {
            fn();
        } finally {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (prev) scrollWrapper.style.setProperty('scroll-behavior', prev, prevPriority || '');
                    else scrollWrapper.style.removeProperty('scroll-behavior');
                });
            });
        }
    }

    function restoreScrollWrapper(fn) {
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
    }

    function jumpScrollWrapperToPercent(percent) {
        if (!scrollWrapper) return;
        const clamped = Math.max(0, Math.min(1, Number(percent)));
        const max = scrollWrapper.scrollHeight - scrollWrapper.clientHeight;
        const target = max > 0 ? clamped * max : 0;
        if (typeof scrollWrapper.scrollTo === 'function') scrollWrapper.scrollTo(0, target);
        else scrollWrapper.scrollTop = target;
    }

    function captureReadingPositionSnapshot() {
        return {
            anchorId: getReadingAnchorId(),
            percent: getScrollPercent()
        };
    }

    function restoreReadingPositionSnapshot(snapshot) {
        if (!snapshot || !scrollWrapper) return;
        const anchorId = snapshot.anchorId;
        const percent = (typeof snapshot.percent === 'number' && Number.isFinite(snapshot.percent)) ? snapshot.percent : 0;

        restoreScrollWrapper(() => {
            withInstantScrollWrapper(() => {
                if (anchorId) {
                    const targetEl = document.getElementById(anchorId);
                    if (targetEl) {
                        try {
                            targetEl.scrollIntoView({ block: 'start' });
                        } catch {
                            targetEl.scrollIntoView();
                        }
                        return;
                    }
                }
                jumpScrollWrapperToPercent(percent);
            });
        });
    }

    let readerProfileSwitchRaf = null;
    function maybeSwitchReaderProfile() {
        if (readerProfileSwitchRaf) return;
        readerProfileSwitchRaf = window.requestAnimationFrame(() => {
            readerProfileSwitchRaf = null;
            const nextProfile = getReaderProfileFromViewport();
            if (nextProfile === currentReaderProfile) return;

            const snapshot = captureReadingPositionSnapshot();

            currentReaderProfile = nextProfile;
            loadSettingsForProfile(currentReaderProfile);

            // Ensure mode-specific UI is not stuck open across breakpoint changes.
            setSettingsOpen(false);
            setSidebarOpen(false);

            applySettings();
            updateThemeIcons();

            if (!currentChapterHref) return;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => restoreReadingPositionSnapshot(snapshot));
            });
        });
    }

    if (sidebarOverlayQuery) {
        const onSidebarOverlayQueryChange = () => maybeSwitchReaderProfile();
        if (typeof sidebarOverlayQuery.addEventListener === 'function') {
            sidebarOverlayQuery.addEventListener('change', onSidebarOverlayQueryChange);
        } else if (typeof sidebarOverlayQuery.addListener === 'function') {
            sidebarOverlayQuery.addListener(onSidebarOverlayQueryChange);
        }
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
            if (!rootFile) throw new Error('Invalid container.xml: No rootfile');

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
                    children.forEach(child => { const subLi = processNavPoint(child); if (subLi) subList.appendChild(subLi); });
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
            if (docTitle) titleEl.textContent = docTitle.textContent.trim();
            return true;
        } catch (e) {
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

            // Ensure scroll is reset immediately for new chapters (prevents retaining old scroll position)
            if (!anchor && (!options || !options.restore) && scrollWrapper) {
                scrollWrapper.scrollTop = 0;
            }

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
                    if (!href.startsWith('/')) target = `${baseDir}/${href}`;
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

    function updateThemeColorMeta() {
        const meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) return;
        try {
            const bg = window.getComputedStyle(document.body).backgroundColor;
            if (bg) meta.setAttribute('content', bg);
        } catch { }
    }

    function applySettings() {
        const normalized = normalizeReaderSettings({
            fontSize: currentFontSize,
            lineHeight: currentLineHeight,
            maxWidth: currentMaxWidth,
            theme: currentTheme,
            fontProfile: currentFontProfile
        }, currentReaderProfile);

        currentFontSize = normalized.fontSize;
        currentLineHeight = normalized.lineHeight;
        currentMaxWidth = normalized.maxWidth;
        currentTheme = normalized.theme;
        currentFontProfile = normalized.fontProfile;

        contentViewer.style.fontSize = `${currentFontSize}%`;
        contentViewer.style.lineHeight = String(currentLineHeight);

        const containerW = scrollWrapper
            ? scrollWrapper.clientWidth
            : (window.innerWidth || document.documentElement.clientWidth || 0);
        let appliedMaxWidth = currentMaxWidth;
        if (Number.isFinite(containerW) && containerW > 0) {
            appliedMaxWidth = Math.min(appliedMaxWidth, containerW);
        }
        contentViewer.style.maxWidth = `${appliedMaxWidth}px`;

        const isDark = currentTheme === 'dark';
        document.body.classList.toggle('dark-mode', isDark);
        document.documentElement.classList.toggle('dark-mode', isDark);
        contentViewer.style.setProperty('--reader-font', getFontStack(currentFontProfile));
        updateThemeColorMeta();

        // Update Font UI
        document.querySelectorAll('.font-family-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.font === currentFontProfile);
        });
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

    function shouldUseHistoryBackToLibrary() {
        if (window.history.length <= 1) return false;
        const ref = document.referrer;
        if (!ref) return false;
        try {
            const refUrl = new URL(ref, window.location.href);
            if (refUrl.origin !== window.location.origin) return false;
            const path = refUrl.pathname || '';
            return path === '/' || path.endsWith('/index.html') || path.endsWith('/index');
        } catch {
            return false;
        }
    }

    function cameFromLibraryReferrer() {
        const ref = document.referrer;
        if (!ref) return false;
        try {
            const refUrl = new URL(ref, window.location.href);
            if (refUrl.origin !== window.location.origin) return false;
            const path = refUrl.pathname || '';
            return path === '/' || path.endsWith('/index.html') || path.endsWith('/index');
        } catch {
            return false;
        }
    }

    // --- Event Listeners ---
    const handleBackToLibrary = (e) => {
        if (!shouldUseHistoryBackToLibrary()) return;
        e.preventDefault();
        try {
            saveReadingProgress({ updateLastReadAt: true });
        } catch { }
        window.history.back();
    };

    if (backToLibraryLink) {
        backToLibraryLink.addEventListener('click', handleBackToLibrary);
    }

    const toolbarHomeBtn = document.getElementById('toolbar-home');
    if (toolbarHomeBtn) {
        toolbarHomeBtn.addEventListener('click', handleBackToLibrary);
    }

    if (toggleSidebarBtn) {
        toggleSidebarBtn.addEventListener('click', () => setSidebarOpen(!sidebar.classList.contains('open')));
    }

    if (closeSidebarBottomBtn) closeSidebarBottomBtn.addEventListener('click', () => setSidebarOpen(false));
    if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', () => setSidebarOpen(false));

    setSidebarOpen(!!(sidebar && sidebar.classList.contains('open')));

    setSettingsOpen(false);

    // if (isSidebarOverlayMode() && cameFromLibraryReferrer()) {
    //     showToast(t('reader.tap_to_toggle_toolbars'), 5000);
    // }

    if (scrollWrapper) {
        scrollWrapper.addEventListener('click', (e) => {
            if (!isSidebarOverlayMode()) return;
            const target = e.target;
            
            // Check if click is on settings sheet or its children - don't close if so
            if (target && target.closest && settingsSheet) {
                if (target.closest('#reader-settings-sheet')) return;
            }
            
            // Check if click is on toolbar or its children - don't close if so
            if (target && target.closest && toolbarBottom) {
                if (target.closest('.reader-toolbar-bottom')) return;
            }

            if (hasActiveTextSelectionInContent()) return;

            // Mobile: Toolbars are resident, tapping content should just close settings/sidebar if open
            if (isSidebarOverlayMode()) {
                if (settingsOpen) {
                    setSettingsOpen(false);
                    return;
                }
                if (sidebar && sidebar.classList.contains('open')) {
                    setSidebarOpen(false);
                    return;
                }
                return;
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

    function updateThemeIcons() {
        const isDark = currentTheme === 'dark';

        const headerBtn = document.getElementById('theme-toggle');
        const headerIcon = headerBtn ? headerBtn.querySelector('i') : null;
        const toolbarIcon = toolbarThemeBtn ? toolbarThemeBtn.querySelector('i') : null;

        [headerIcon, toolbarIcon].forEach((icon) => {
            if (!icon) return;
            icon.classList.toggle('fa-moon', isDark);
            icon.classList.toggle('fa-sun', !isDark);
        });
    }

    function toggleTheme() {
        const next = currentTheme === 'dark' ? 'light' : 'dark';
        persistSettingsForCurrentProfile({ theme: next });
        applySettings();
        updateThemeIcons();
    }

    function getCurrentReaderLimits() {
        const profile = currentReaderProfile === READER_PROFILE_MOBILE ? READER_PROFILE_MOBILE : READER_PROFILE_DESKTOP;
        return READER_SETTINGS_LIMITS[profile];
    }

    const FONT_SIZE_STEP = 10;
    function adjustFontSize(delta) {
        const limits = getCurrentReaderLimits().fontSize;
        const next = clampNumber(currentFontSize + delta, limits.min, limits.max);
        if (next === null) return;
        persistSettingsForCurrentProfile({ fontSize: snapToStep(next, limits.step) });
        applySettings();
    }

    const LINE_HEIGHT_STEP = 0.1;
    function adjustLineHeight(delta) {
        const limits = getCurrentReaderLimits().lineHeight;
        const next = clampNumber(currentLineHeight + delta, limits.min, limits.max);
        if (next === null) return;
        const snapped = snapToStep(next, limits.step);
        persistSettingsForCurrentProfile({ lineHeight: Math.round(snapped * 100) / 100 });
        applySettings();
    }

    const themeToggleBtn = document.getElementById('theme-toggle');
    if (themeToggleBtn) themeToggleBtn.addEventListener('click', () => toggleTheme());
    if (toolbarThemeBtn) {
        toolbarThemeBtn.addEventListener('click', () => {
            setSettingsOpen(false);
            toggleTheme();
        });
    }

    const fontIncreaseBtn = document.getElementById('font-increase');
    if (fontIncreaseBtn) fontIncreaseBtn.addEventListener('click', () => adjustFontSize(FONT_SIZE_STEP));
    const fontDecreaseBtn = document.getElementById('font-decrease');
    if (fontDecreaseBtn) fontDecreaseBtn.addEventListener('click', () => adjustFontSize(-FONT_SIZE_STEP));

    const WIDTH_STEP = 80;

    const marginIncreaseBtn = document.getElementById('margin-increase');
    if (marginIncreaseBtn) {
        marginIncreaseBtn.addEventListener('click', () => adjustMaxWidth(-WIDTH_STEP));
    }

    const marginDecreaseBtn = document.getElementById('margin-decrease');
    if (marginDecreaseBtn) {
        marginDecreaseBtn.addEventListener('click', () => adjustMaxWidth(WIDTH_STEP));
    }

    function adjustMaxWidth(delta) {
        const limits = getCurrentReaderLimits().maxWidth;
        const next = clampNumber(currentMaxWidth + delta, limits.min, limits.max);
        if (next === null) return;
        persistSettingsForCurrentProfile({ maxWidth: snapToStep(next, limits.step) });
        showToast(t('reader.width_toast', { px: currentMaxWidth }));
        applySettings();
    }

    if (sheetFontDecreaseBtn) sheetFontDecreaseBtn.addEventListener('click', () => adjustFontSize(-FONT_SIZE_STEP));
    if (sheetFontIncreaseBtn) sheetFontIncreaseBtn.addEventListener('click', () => adjustFontSize(FONT_SIZE_STEP));
    if (sheetMarginIncreaseBtn) sheetMarginIncreaseBtn.addEventListener('click', () => adjustMaxWidth(-WIDTH_STEP));
    if (sheetMarginDecreaseBtn) sheetMarginDecreaseBtn.addEventListener('click', () => adjustMaxWidth(WIDTH_STEP));
    if (sheetLineHeightDecreaseBtn) sheetLineHeightDecreaseBtn.addEventListener('click', () => adjustLineHeight(-LINE_HEIGHT_STEP));
    if (sheetLineHeightIncreaseBtn) sheetLineHeightIncreaseBtn.addEventListener('click', () => adjustLineHeight(LINE_HEIGHT_STEP));

    if (toolbarTocBtn) {
        toolbarTocBtn.addEventListener('click', () => {
            setSettingsOpen(false);
            setSidebarOpen(!sidebar.classList.contains('open'));
        });
    }

    if (toolbarTypographyBtn) {
        toolbarTypographyBtn.addEventListener('click', () => {
            setSidebarOpen(false);
            setSettingsOpen(!settingsOpen);
        });
    }

    // Handle Setting Sheet Font Buttons
    document.querySelectorAll('.font-family-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const profile = btn.dataset.font;
            if (READER_FONT_PROFILES.includes(profile)) {
                persistSettingsForCurrentProfile({ fontProfile: profile });
                applySettings();
            }
        });
    });

    const fontChangeBtn = document.getElementById('font-change');
    if (fontChangeBtn) {
        fontChangeBtn.onclick = () => {
            const currentIndex = READER_FONT_PROFILES.indexOf(currentFontProfile);
            const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % READER_FONT_PROFILES.length;
            const nextProfile = READER_FONT_PROFILES[nextIndex] || 'serif';
            persistSettingsForCurrentProfile({ fontProfile: nextProfile });
            // updateFontChangeTitle(); // Deprecated in favor of sheet buttons
            showToast(t('reader.font_toast', { profile: currentFontProfile }));
            applySettings();
        };
        // updateFontChangeTitle();
    }

    // --- Touch / Swipe Support ---
    let touchStartX = null;
    let touchStartY = null;
    let touchStartScrollTop = null;
    const SWIPE_THRESHOLD_PX = 80;
    const SWIPE_MAX_VERTICAL_DRIFT_PX = 28;
    const SWIPE_HORIZONTAL_RATIO = 1.5;
    const SCROLL_GUARD_PX = 10;

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
        touchStartScrollTop = scrollWrapper ? scrollWrapper.scrollTop : null;
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

        // If the user scrolled vertically, avoid treating it as a swipe.
        if (touchStartScrollTop !== null && scrollWrapper) {
            const scrollDelta = Math.abs(scrollWrapper.scrollTop - touchStartScrollTop);
            if (scrollDelta > SCROLL_GUARD_PX) {
                touchStartX = null;
                touchStartY = null;
                touchStartScrollTop = null;
                return;
            }
        }

        handleSwipe(touchStartX, touchStartY, touchEndX, touchEndY);
        touchStartX = null;
        touchStartScrollTop = null;
    }, { passive: true });

    scrollWrapper.addEventListener('touchcancel', () => {
        touchStartX = null;
        touchStartY = null;
        touchStartScrollTop = null;
    }, { passive: true });

    // Persist reading position within long chapters
    scrollWrapper.addEventListener('scroll', () => {
        scheduleProgressSave(false, { updateLastReadAt: true });
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') scheduleProgressSave(true, { updateLastReadAt: true });
    });
    window.addEventListener('beforeunload', () => scheduleProgressSave(true, { updateLastReadAt: true }));
    window.addEventListener('resize', () => {
        maybeSwitchReaderProfile();
    });

    function handleSwipe(startX, startY, endX, endY) {
        const diffX = endX - startX;
        const diffY = endY - startY;
        const absX = Math.abs(diffX);
        const absY = Math.abs(diffY);
        const isHorizontal = absX >= absY * SWIPE_HORIZONTAL_RATIO && absY <= SWIPE_MAX_VERTICAL_DRIFT_PX;

        if (!isHorizontal) return;
        if (absX <= SWIPE_THRESHOLD_PX) return;

        if (diffX > 0) {
            // Swipe Right -> Previous
            if (!prevBtn.disabled) prevBtn.click();
        } else {
            // Swipe Left -> Next
            if (!nextBtn.disabled) nextBtn.click();
        }
    }

    // Initial Load
    window.addEventListener('ui-language-changed', () => {
        updateFontChangeTitle();
        renderNotesList();
    });
    applySettings();
    updateThemeIcons();
    loadToc();
});
