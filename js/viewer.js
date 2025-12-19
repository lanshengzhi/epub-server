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
    const notesBtn = document.getElementById('notes-btn');
    const toggleSidebarBtn = document.getElementById('toggle-sidebar');
    const closeSidebarBtn = document.getElementById('close-sidebar');
    const closeSidebarBottomBtn = document.getElementById('close-sidebar-bottom');
    const sidebarBackdrop = document.getElementById('sidebar-backdrop');
    const bottomToolbar = document.getElementById('reader-toolbar-bottom');
    const toolbarTocBtn = document.getElementById('toolbar-toc');
    const toolbarNotesBtn = document.getElementById('toolbar-notes');
    const toolbarThemeBtn = document.getElementById('toolbar-theme');
    const toolbarTypographyBtn = document.getElementById('toolbar-typography');
    const settingsSheet = document.getElementById('reader-settings-sheet');
    const sheetFontDecreaseBtn = document.getElementById('sheet-font-decrease');
    const sheetFontIncreaseBtn = document.getElementById('sheet-font-increase');
    const sheetMarginIncreaseBtn = document.getElementById('sheet-margin-increase');
    const sheetMarginDecreaseBtn = document.getElementById('sheet-margin-decrease');
    const sheetLineHeightDecreaseBtn = document.getElementById('sheet-line-height-decrease');
    const sheetLineHeightIncreaseBtn = document.getElementById('sheet-line-height-increase');
    const progressIndicator = document.getElementById('reader-progress-indicator');
    const selectionToolbar = document.getElementById('selection-toolbar');
    const annoMenu = document.getElementById('anno-menu');
    const noteModal = document.getElementById('note-modal');
    const noteInput = document.getElementById('note-input');
    const noteSelectedText = document.getElementById('note-selected-text');
    const noteCancelBtn = document.getElementById('note-cancel');
    const noteSaveBtn = document.getElementById('note-save');
    const noteStyleBgBtn = document.getElementById('note-style-bg');
    const noteStyleUlBtn = document.getElementById('note-style-ul');
    const notesModal = document.getElementById('notes-modal');
    const notesList = document.getElementById('notes-list');
    const notesCloseBtn = document.getElementById('notes-close');

    // Config
    const BOOK_KEY = `progress_${bookDir}`;
    const THEME_KEY = 'theme';
    const TOAST_DURATION_MS = 2000;
    const PROGRESS_VERSION = 3;
    const READING_BLOCK_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, dt, dd';
    const AUTO_ANCHOR_PREFIX = '__epub_auto_';
    const ANNOTATION_STYLE_BG = 'bg';
    const ANNOTATION_STYLE_UL = 'ul';
    const ANNOTATIONS_API_BASE = `/api/books/${encodeURIComponent(bookDir)}/annotations`;

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

    const topToolbar = document.querySelector('.reader-header');
    let toolbarsVisible = false;
    let settingsOpen = false;

    function setSettingsOpen(isOpen) {
        settingsOpen = !!isOpen;
        const active = isSidebarOverlayMode();
        if (!active) settingsOpen = false;
        document.body.classList.toggle('settings-open', active && settingsOpen);
        if (settingsSheet) settingsSheet.setAttribute('aria-hidden', active && settingsOpen ? 'false' : 'true');
    }

    function setToolbarsVisible(isVisible) {
        toolbarsVisible = !!isVisible;
        const active = isSidebarOverlayMode();
        const visible = active && toolbarsVisible;
        if (!active) toolbarsVisible = false;

        document.body.classList.toggle('toolbars-visible', visible);
        if (bottomToolbar) bottomToolbar.setAttribute('aria-hidden', visible ? 'false' : 'true');
        if (topToolbar && active) topToolbar.setAttribute('aria-hidden', visible ? 'false' : 'true');

        if (!visible) {
            setSettingsOpen(false);
            setSidebarOpen(false);
        }
    }

    // --- Annotations (Highlights / Notes) ---
    let annotations = [];
    let annotationsLoadPromise = null;
    let currentChapterTitle = null;
    let selectionContext = null;
    let activeAnnoId = null;
    let noteModalMode = null; // 'create' | 'edit'
    let noteModalAnnoId = null;
    let noteModalPendingContext = null;
    let noteModalStyle = ANNOTATION_STYLE_BG;

    function normalizeAnnotationStyle(style) {
        const raw = String(style || '').trim().toLowerCase();
        if (raw === ANNOTATION_STYLE_UL || raw === 'underline') return ANNOTATION_STYLE_UL;
        return ANNOTATION_STYLE_BG;
    }

    function clearTextSelection() {
        const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
        if (!sel) return;
        try {
            sel.removeAllRanges();
        } catch { }
    }

    async function copyToClipboard(text) {
        const value = String(text || '');
        if (!value) return false;
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(value);
                return true;
            }
        } catch { }

        try {
            const textarea = document.createElement('textarea');
            textarea.value = value;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            textarea.style.top = '0';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(textarea);
            return !!ok;
        } catch {
            return false;
        }
    }

    function isNodeInsideContent(node) {
        return !!(node && contentViewer && contentViewer.contains(node.nodeType === 1 ? node : node.parentNode));
    }

    function getSelectionRangeInContent() {
        const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
        const range = sel.getRangeAt(0);
        if (!range) return null;
        const anchorNode = sel.anchorNode;
        const focusNode = sel.focusNode;
        if (!isNodeInsideContent(anchorNode) && !isNodeInsideContent(focusNode)) return null;
        return range;
    }

    function getBlockForNode(node) {
        if (!node) return null;
        const el = node.nodeType === 1 ? node : node.parentElement;
        if (!el || typeof el.closest !== 'function') return null;
        const block = el.closest(READING_BLOCK_SELECTOR);
        return block && contentViewer.contains(block) ? block : null;
    }

    function computeOffsetsWithinBlock(block, range) {
        const prefix = document.createRange();
        prefix.selectNodeContents(block);
        prefix.setEnd(range.startContainer, range.startOffset);
        const start = prefix.toString().length;
        const selectedText = range.toString();
        const end = start + selectedText.length;
        return { start, end, text: selectedText };
    }

    function getSelectionContextFromWindow() {
        if (!currentChapterHref) return null;
        const range = getSelectionRangeInContent();
        if (!range) return null;

        const startBlock = getBlockForNode(range.startContainer);
        const endBlock = getBlockForNode(range.endContainer);
        if (!startBlock || !endBlock || startBlock !== endBlock) {
            const text = range.toString();
            if (!text || !text.trim()) return null;
            return {
                href: currentChapterHref,
                text,
                chapterTitle: currentChapterTitle,
                error: 'multi_block'
            };
        }

        const blockId = startBlock.id;
        if (!blockId) {
            return { error: 'missing_anchor' };
        }

        const { start, end, text } = computeOffsetsWithinBlock(startBlock, range);
        if (!text || !text.trim() || end <= start) return null;

        return {
            href: currentChapterHref,
            anchorId: blockId,
            start,
            end,
            text,
            context: startBlock.textContent || '',
            chapterTitle: currentChapterTitle
        };
    }

    function positionFloatingEl(el, rect, { offset = 10 } = {}) {
        if (!el || !rect) return;
        const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
        el.style.left = '0px';
        el.style.top = '0px';
        el.classList.add('show');

        const { width, height } = el.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        let left = centerX - width / 2;
        left = Math.max(8, Math.min(viewportW - width - 8, left));

        let top = rect.top - height - offset;
        if (top < 8) top = rect.bottom + offset;
        top = Math.max(8, Math.min(viewportH - height - 8, top));

        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
    }

    function showSelectionToolbar(context, rectOverride = null) {
        if (!selectionToolbar) return;
        selectionContext = context;

        let rect = rectOverride;
        if (!rect) {
            const range = getSelectionRangeInContent();
            if (!range) {
                selectionToolbar.classList.remove('show');
                return;
            }
            const rects = range.getClientRects();
            rect = rects && rects.length > 0 ? rects[0] : range.getBoundingClientRect();
        }

        if (!rect || (rect.width === 0 && rect.height === 0)) {
            selectionToolbar.classList.remove('show');
            return;
        }
        positionFloatingEl(selectionToolbar, rect, { offset: 12 });
        selectionToolbar.setAttribute('aria-hidden', 'false');
    }

    function hideSelectionToolbar() {
        if (!selectionToolbar) return;
        selectionToolbar.classList.remove('show');
        selectionToolbar.setAttribute('aria-hidden', 'true');
        selectionContext = null;
        removeTempSelection();
    }

    function hideAnnoMenu() {
        if (!annoMenu) return;
        annoMenu.classList.remove('show');
        annoMenu.setAttribute('aria-hidden', 'true');
        activeAnnoId = null;
    }

    function updateSelectionUI() {
        const ctx = getSelectionContextFromWindow();
        if (!ctx || (ctx.error && ctx.error !== 'multi_block')) {
            hideSelectionToolbar();
            return;
        }

        // Try to apply temporary selection (fake highlight) and clear native selection
        // This prevents the iOS context menu from appearing.
        if (!ctx.error) {
            removeTempSelection();
            const tempSpan = applyTempSelection(ctx);
            if (tempSpan) {
                clearTextSelection();
                const rect = tempSpan.getBoundingClientRect();
                showSelectionToolbar(ctx, rect);
                return;
            }
        }

        showSelectionToolbar(ctx);
    }

    function removeTempSelection() {
        if (!contentViewer) return;
        const spans = Array.from(contentViewer.querySelectorAll('span.temp-selection'));
        spans.forEach(unwrapElement);
    }

    function applyTempSelection(ctx) {
        if (!ctx || !contentViewer) return null;
        const block = contentViewer.querySelector(`#${CSS.escape(ctx.anchorId)}`);
        if (!block) return null;

        const start = Number(ctx.start);
        const end = Number(ctx.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

        // Ensure buildRangeFromOffsets is available (it is hoisted)
        const range = buildRangeFromOffsets(block, start, end);
        if (!range || range.collapsed) return null;

        const wrapper = document.createElement('span');
        wrapper.className = 'temp-selection';

        try {
            const frag = range.extractContents();
            wrapper.appendChild(frag);
            range.insertNode(wrapper);
            return wrapper;
        } catch (e) {
            console.warn('Failed to apply temp selection', e);
            return null;
        }
    }

    function unwrapElement(el) {
        if (!el || !el.parentNode) return;
        const parent = el.parentNode;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
    }

    function clearAnnotationSpans(container) {
        if (!container) return;
        const spans = Array.from(container.querySelectorAll('span.anno[data-anno-id]'));
        spans.forEach(unwrapElement);
    }

    function buildRangeFromOffsets(block, start, end) {
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
        let node = walker.nextNode();
        let pos = 0;
        let startNode = null;
        let startOffset = 0;
        let endNode = null;
        let endOffset = 0;

        while (node) {
            const len = node.nodeValue ? node.nodeValue.length : 0;
            if (startNode === null && pos + len >= start) {
                startNode = node;
                startOffset = Math.max(0, start - pos);
            }
            if (pos + len >= end) {
                endNode = node;
                endOffset = Math.max(0, end - pos);
                break;
            }
            pos += len;
            node = walker.nextNode();
        }

        if (!startNode || !endNode) return null;
        const range = document.createRange();
        try {
            range.setStart(startNode, startOffset);
            range.setEnd(endNode, endOffset);
        } catch {
            return null;
        }
        return range;
    }

    function applyAnnotationSpan(annotation, container) {
        if (!annotation || !container) return;
        const block = container.querySelector(`#${CSS.escape(annotation.anchorId)}`);
        if (!block) return;

        const start = Number(annotation.start);
        const end = Number(annotation.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;

        const range = buildRangeFromOffsets(block, start, end);
        if (!range || range.collapsed) return;

        const wrapper = document.createElement('span');
        wrapper.className = 'anno';
        wrapper.dataset.annoId = annotation.id;
        wrapper.dataset.style = annotation.style;
        if (normalizeAnnotationStyle(annotation.style) === ANNOTATION_STYLE_UL) wrapper.classList.add('anno-ul');
        else wrapper.classList.add('anno-bg');
        if (annotation.note && String(annotation.note).trim()) wrapper.classList.add('anno-has-note');

        try {
            const frag = range.extractContents();
            wrapper.appendChild(frag);
            range.insertNode(wrapper);
        } catch (e) {
            console.warn('Failed to apply annotation span', e);
        }
    }

    function findAnnotationById(id) {
        return annotations.find(a => a && a.id === id) || null;
    }

    function isOverlappingAnnotation(ctx) {
        if (!ctx || !ctx.href || !ctx.anchorId) return false;
        const start = Number(ctx.start);
        const end = Number(ctx.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
        return annotations.some(a => {
            if (!a || a.href !== ctx.href || a.anchorId !== ctx.anchorId) return false;
            const aStart = Number(a.start);
            const aEnd = Number(a.end);
            if (!Number.isFinite(aStart) || !Number.isFinite(aEnd)) return false;
            return start < aEnd && aStart < end;
        });
    }

    async function ensureAnnotationsLoaded() {
        if (annotationsLoadPromise) return annotationsLoadPromise;
        annotationsLoadPromise = (async () => {
            try {
                const res = await fetch(ANNOTATIONS_API_BASE);
                if (!res.ok) throw new Error(`Status: ${res.status}`);
                const data = await res.json();
                annotations = Array.isArray(data.annotations) ? data.annotations : [];
            } catch (e) {
                console.warn('Failed to load annotations', e);
                annotations = [];
            }
        })();
        return annotationsLoadPromise;
    }

    async function refreshAnnotations({ silent = false } = {}) {
        annotationsLoadPromise = null;
        await ensureAnnotationsLoaded();
        if (!silent && currentChapterHref) {
            clearAnnotationSpans(contentViewer);
            const chapterAnnos = annotations.filter(a => a && a.href === currentChapterHref);
            chapterAnnos.forEach(a => applyAnnotationSpan(a, contentViewer));
        }
    }

    async function apiCreateAnnotation(payload) {
        const res = await fetch(ANNOTATIONS_API_BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`Status: ${res.status}`);
        const data = await res.json();
        if (!data || !data.annotation) throw new Error('Missing annotation');
        return data.annotation;
    }

    async function apiUpdateAnnotation(id, patch) {
        const res = await fetch(`${ANNOTATIONS_API_BASE}/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch)
        });
        if (!res.ok) throw new Error(`Status: ${res.status}`);
        const data = await res.json();
        if (!data || !data.annotation) throw new Error('Missing annotation');
        return data.annotation;
    }

    async function apiDeleteAnnotation(id) {
        const res = await fetch(`${ANNOTATIONS_API_BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`Status: ${res.status}`);
        const data = await res.json().catch(() => ({}));
        if (data && data.success === false) throw new Error('Delete failed');
        return true;
    }

    async function renderAnnotationsForChapter(href, requestId) {
        await ensureAnnotationsLoaded();
        if (requestId !== undefined && requestId !== loadChapterRequestId) return;
        clearAnnotationSpans(contentViewer);
        const chapterAnnos = annotations.filter(a => a && a.href === href);
        chapterAnnos.forEach(a => applyAnnotationSpan(a, contentViewer));
    }

    async function createAnnotationFromContext(ctx, { style, note } = {}) {
        if (!ctx) return;
        await ensureAnnotationsLoaded();
        if (ctx.error === 'multi_block') {
            showToast(t('reader.annotation_single_paragraph_only'));
            return;
        }
        if (ctx.error) return;

        if (isOverlappingAnnotation(ctx)) {
            showToast(t('reader.annotation_overlap_not_supported'));
            return;
        }

        const created = await apiCreateAnnotation({
            href: ctx.href,
            anchorId: ctx.anchorId,
            start: ctx.start,
            end: ctx.end,
            style: normalizeAnnotationStyle(style),
            text: ctx.text,
            note: note ? String(note) : '',
            chapterTitle: ctx.chapterTitle,
            context: ctx.context
        });
        annotations.push(created);
        if (created.href === currentChapterHref) applyAnnotationSpan(created, contentViewer);
        return created;
    }

    function openNotesModal() {
        if (!notesModal) return;
        notesModal.classList.add('show');
    }

    function closeNotesModal() {
        if (!notesModal) return;
        notesModal.classList.remove('show');
    }

    function renderNotesList() {
        if (!notesList) return;
        notesList.innerHTML = '';

        const items = annotations
            .filter(a => a && a.note && String(a.note).trim())
            .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'notes-empty';
            empty.textContent = t('reader.no_notes');
            notesList.appendChild(empty);
            return;
        }

        items.forEach(anno => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'note-item';
            row.addEventListener('click', () => {
                closeNotesModal();
                loadChapter(`${anno.href}#${anno.anchorId}`);
            });

            const title = document.createElement('div');
            title.className = 'note-item-title';
            // Show Chapter Title
            const chapterTitle = anno.chapterTitle || t('reader.unknown_chapter');
            title.textContent = chapterTitle;

            const contextEl = document.createElement('div');
            contextEl.className = 'note-item-context';
            // Show Context (fallback to selected text if no context)
            contextEl.textContent = anno.context || anno.text || '';
            contextEl.style.fontSize = '0.85em';
            contextEl.style.color = '#666';
            contextEl.style.marginBottom = '4px';
            contextEl.style.display = '-webkit-box';
            contextEl.style.webkitLineClamp = '2';
            contextEl.style.webkitBoxOrient = 'vertical';
            contextEl.style.overflow = 'hidden';

            const note = document.createElement('div');
            note.className = 'note-item-note';
            note.textContent = String(anno.note || '');

            row.appendChild(title);
            if (contextEl.textContent) row.appendChild(contextEl);
            row.appendChild(note);
            notesList.appendChild(row);
        });
    }

    function openNoteModal({ mode, annoId, context, style }) {
        if (!noteModal || !noteInput) return;
        noteModalMode = mode;
        noteModalAnnoId = annoId || null;
        noteModalPendingContext = context || null;
        noteModalStyle = normalizeAnnotationStyle(style);

        if (noteSelectedText) {
            const text = context && context.text ? String(context.text).trim() : '';
            noteSelectedText.textContent = text ? text : '';
            noteSelectedText.style.display = text ? '' : 'none';
        }

        setNoteModalStyle(noteModalStyle);

        if (mode === 'edit' && annoId) {
            const anno = findAnnotationById(annoId);
            noteInput.value = (anno && anno.note) ? String(anno.note) : '';
        } else {
            noteInput.value = '';
        }

        noteModal.classList.add('show');
        noteInput.focus();
    }

    function setNoteModalStyle(style) {
        noteModalStyle = normalizeAnnotationStyle(style);
        if (!noteStyleBgBtn || !noteStyleUlBtn) return;
        const isUl = noteModalStyle === ANNOTATION_STYLE_UL;
        noteStyleBgBtn.classList.toggle('active', !isUl);
        noteStyleUlBtn.classList.toggle('active', isUl);
    }

    function closeNoteModal() {
        if (!noteModal) return;
        noteModal.classList.remove('show');
        noteModalMode = null;
        noteModalAnnoId = null;
        noteModalPendingContext = null;
        noteModalStyle = ANNOTATION_STYLE_BG;
    }

    async function saveNoteModal() {
        if (!noteInput) return;
        if (noteModalMode === 'edit' && noteModalAnnoId) {
            const note = String(noteInput.value || '').trim();
            try {
                const existing = findAnnotationById(noteModalAnnoId);
                const patch = { note };
                if (existing && normalizeAnnotationStyle(existing.style) !== noteModalStyle) {
                    patch.style = noteModalStyle;
                }
                const updated = await apiUpdateAnnotation(noteModalAnnoId, patch);
                const idx = annotations.findIndex(a => a && a.id === noteModalAnnoId);
                if (idx !== -1) annotations[idx] = updated;
                const spans = Array.from(contentViewer.querySelectorAll(`span.anno[data-anno-id="${CSS.escape(noteModalAnnoId)}"]`));
                spans.forEach(s => {
                    const hasNote = updated.note && String(updated.note).trim();
                    s.classList.toggle('anno-has-note', !!hasNote);
                    s.classList.toggle('anno-ul', normalizeAnnotationStyle(updated.style) === ANNOTATION_STYLE_UL);
                    s.classList.toggle('anno-bg', normalizeAnnotationStyle(updated.style) !== ANNOTATION_STYLE_UL);
                    s.dataset.style = updated.style;
                });
                closeNoteModal();
                renderNotesList();
            } catch (e) {
                console.warn(e);
                showToast(t('reader.annotation_update_failed'));
            }
            return;
        }

        const note = String(noteInput.value || '').trim();
        if (!note) {
            closeNoteModal();
            return;
        }

        const ctx = noteModalPendingContext;
        if (!ctx) {
            closeNoteModal();
            return;
        }
        await ensureAnnotationsLoaded();
        if (isOverlappingAnnotation(ctx)) {
            closeNoteModal();
            showToast(t('reader.annotation_overlap_not_supported'));
            return;
        }

        try {
            const created = await apiCreateAnnotation({
                href: ctx.href,
                anchorId: ctx.anchorId,
                start: ctx.start,
                end: ctx.end,
                style: noteModalStyle,
                text: ctx.text,
                note,
                chapterTitle: ctx.chapterTitle,
                context: ctx.context
            });
            annotations.push(created);
            if (created.href === currentChapterHref) applyAnnotationSpan(created, contentViewer);
            closeNoteModal();
            clearTextSelection();
            renderNotesList();
        } catch (e) {
            console.warn(e);
            showToast(t('reader.annotation_save_failed'));
        }
    }

    function openAnnoMenuForSpan(span) {
        if (!span || !annoMenu) return;
        const annoId = span.dataset.annoId;
        const anno = annoId ? findAnnotationById(annoId) : null;
        if (!anno) return;

        activeAnnoId = anno.id;

        const toggleBtn = annoMenu.querySelector('[data-action="toggle-style"]');
        const editBtn = annoMenu.querySelector('[data-action="edit-note"]');
        if (toggleBtn) {
            toggleBtn.textContent =
                normalizeAnnotationStyle(anno.style) === ANNOTATION_STYLE_UL
                    ? t('reader.annot_switch_to_highlight')
                    : t('reader.annot_switch_to_underline');
        }
        if (editBtn) {
            editBtn.textContent = anno.note && String(anno.note).trim() ? t('reader.annot_edit_note') : t('reader.annot_add_note');
        }

        const rect = span.getBoundingClientRect();
        positionFloatingEl(annoMenu, rect, { offset: 10 });
        annoMenu.setAttribute('aria-hidden', 'false');
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

    // Settings State
    let currentFontSize = parseInt(localStorage.getItem('fontSize')) || 100;
    let currentTheme = localStorage.getItem('theme') || 'light';
    let currentMaxWidth = parseInt(localStorage.getItem('maxWidth')) || 800;
    let currentLineHeight = parseFloat(localStorage.getItem('lineHeight'));
    if (!Number.isFinite(currentLineHeight)) currentLineHeight = 1.8;
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

    function getDisplayScrollPercent() {
        const max = scrollWrapper.scrollHeight - scrollWrapper.clientHeight;
        if (max <= 0) return 1;
        return Math.max(0, Math.min(1, scrollWrapper.scrollTop / max));
    }

    function getDisplayPageProgress() {
        const viewportH = scrollWrapper.clientHeight;
        const scrollH = scrollWrapper.scrollHeight;
        if (!Number.isFinite(viewportH) || !Number.isFinite(scrollH) || viewportH <= 0 || scrollH <= 0) {
            return { page: 1, totalPages: 1 };
        }
        const totalPages = Math.max(1, Math.ceil(scrollH / viewportH));
        const page = Math.max(1, Math.min(totalPages, Math.floor(scrollWrapper.scrollTop / viewportH) + 1));
        return { page, totalPages };
    }

    function getDisplayBookPercent(chapterPercent) {
        const total = spineItems.length;
        if (!Number.isFinite(chapterPercent)) return 0;
        if (!Number.isFinite(total) || total <= 0) return Math.max(0, Math.min(1, chapterPercent));
        if (!Number.isFinite(currentSpineIndex) || currentSpineIndex < 0) return Math.max(0, Math.min(1, chapterPercent));
        const value = (currentSpineIndex + chapterPercent) / total;
        return Math.max(0, Math.min(1, value));
    }

    let progressIndicatorRaf = null;
    function updateProgressIndicator() {
        // Feature disabled
        return;
    }

    function scheduleProgressIndicatorUpdate() {
        if (!progressIndicator || progressIndicatorRaf) return;
        progressIndicatorRaf = window.requestAnimationFrame(() => {
            progressIndicatorRaf = null;
            updateProgressIndicator();
        });
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
        hideSelectionToolbar();
        hideAnnoMenu();

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
        currentChapterTitle = activeLink ? activeLink.textContent : null;

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
            await renderAnnotationsForChapter(normalizedFilePath, requestId);

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
        // Prevent "Wider Text" from becoming too wide on touch devices.
        const isTouchDevice = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
        const maxWidthCap = isTouchDevice ? 900 : Number.POSITIVE_INFINITY;
        if (currentMaxWidth > maxWidthCap) {
            currentMaxWidth = maxWidthCap;
            localStorage.setItem('maxWidth', currentMaxWidth);
        }

        contentViewer.style.fontSize = `${currentFontSize}%`;
        contentViewer.style.lineHeight = String(currentLineHeight);
        contentViewer.style.maxWidth = `${currentMaxWidth}px`;
        const isDark = currentTheme === 'dark';
        document.body.classList.toggle('dark-mode', isDark);
        document.documentElement.classList.toggle('dark-mode', isDark);
        contentViewer.style.setProperty('--reader-font', getFontStack(currentFontProfile));
        updateThemeColorMeta();
        scheduleProgressIndicatorUpdate();

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

    if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', () => setSidebarOpen(false));
    if (closeSidebarBottomBtn) closeSidebarBottomBtn.addEventListener('click', () => setSidebarOpen(false));
    if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', () => setSidebarOpen(false));

    setSidebarOpen(!!(sidebar && sidebar.classList.contains('open')));

    setToolbarsVisible(false);
    setSettingsOpen(false);

    // if (isSidebarOverlayMode() && cameFromLibraryReferrer()) {
    //     showToast(t('reader.tap_to_toggle_toolbars'), 5000);
    // }

    if (scrollWrapper) {
        scrollWrapper.addEventListener('click', (e) => {
            if (!isSidebarOverlayMode()) return;
            if (e.defaultPrevented) return;
            if (noteModal && noteModal.classList.contains('show')) return;
            if (notesModal && notesModal.classList.contains('show')) return;

            const target = e.target;
            if (target && target.closest) {
                if (target.closest('a, button, input, textarea, select, label')) return;
                if (target.closest('img')) return;
            }

            if (hasActiveTextSelectionInContent()) return;

            // Mobile: Toolbars are resident, tapping content should just close settings/sidebar if open
            if (isSidebarOverlayMode()) {
                if (settingsGroup && settingsGroup.classList.contains('show')) {
                    settingsGroup.classList.remove('show');
                    return;
                }
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

            setToolbarsVisible(!toolbarsVisible);
        });
    }

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
        currentTheme = currentTheme === 'light' ? 'dark' : 'light';
        localStorage.setItem(THEME_KEY, currentTheme);
        applySettings();
        updateThemeIcons();
    }

    const FONT_SIZE_STEP = 10;
    function adjustFontSize(delta) {
        const next = Math.max(50, currentFontSize + delta);
        currentFontSize = next;
        localStorage.setItem('fontSize', currentFontSize);
        applySettings();
    }

    const LINE_HEIGHT_MIN = 1.2;
    const LINE_HEIGHT_MAX = 2.4;
    const LINE_HEIGHT_STEP = 0.1;
    function adjustLineHeight(delta) {
        const next = Math.max(LINE_HEIGHT_MIN, Math.min(LINE_HEIGHT_MAX, currentLineHeight + delta));
        currentLineHeight = Math.round(next * 100) / 100;
        localStorage.setItem('lineHeight', String(currentLineHeight));
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
        marginIncreaseBtn.addEventListener('click', () => adjustMaxWidth(-WIDTH_STEP));
    }

    const marginDecreaseBtn = document.getElementById('margin-decrease');
    if (marginDecreaseBtn) {
        marginDecreaseBtn.addEventListener('click', () => adjustMaxWidth(WIDTH_STEP));
    }

    function adjustMaxWidth(delta) {
        currentMaxWidth = Math.max(MIN_MAX_WIDTH, Math.min(getMaxWidthCap(), currentMaxWidth + delta));
        localStorage.setItem('maxWidth', currentMaxWidth);
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

    const fontProfiles = ['serif', 'sans', 'mono'];

    // Handle Setting Sheet Font Buttons
    document.querySelectorAll('.font-family-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const profile = btn.dataset.font;
            if (fontProfiles.includes(profile)) {
                currentFontProfile = profile;
                localStorage.setItem('fontProfile', currentFontProfile);
                applySettings();
            }
        });
    });

    const fontChangeBtn = document.getElementById('font-change');
    if (fontChangeBtn) {
        fontChangeBtn.onclick = () => {
            const currentIndex = fontProfiles.indexOf(currentFontProfile);
            const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % fontProfiles.length;
            currentFontProfile = fontProfiles[nextIndex];
            localStorage.setItem('fontProfile', currentFontProfile);
            // updateFontChangeTitle(); // Deprecated in favor of sheet buttons
            showToast(t('reader.font_toast', { profile: currentFontProfile }));
            applySettings();
        };
        // updateFontChangeTitle();
    }

    // --- Highlight / Notes UI ---
    async function openNotesUI() {
        setSettingsOpen(false);
        setSidebarOpen(false);
        hideSelectionToolbar();
        hideAnnoMenu();
        await refreshAnnotations({ silent: true });
        renderNotesList();
        openNotesModal();
    }

    if (notesBtn) {
        notesBtn.addEventListener('click', async () => openNotesUI());
    }
    if (toolbarNotesBtn) {
        toolbarNotesBtn.addEventListener('click', async () => openNotesUI());
    }

    if (notesCloseBtn) {
        notesCloseBtn.addEventListener('click', () => closeNotesModal());
    }
    if (notesModal) {
        notesModal.addEventListener('click', (e) => {
            if (e.target === notesModal) closeNotesModal();
        });
    }

    if (noteCancelBtn) {
        noteCancelBtn.addEventListener('click', () => closeNoteModal());
    }
    if (noteSaveBtn) {
        noteSaveBtn.addEventListener('click', () => saveNoteModal());
    }
    if (noteModal) {
        noteModal.addEventListener('click', (e) => {
            if (e.target === noteModal) closeNoteModal();
        });
    }
    if (noteStyleBgBtn) noteStyleBgBtn.addEventListener('click', () => setNoteModalStyle(ANNOTATION_STYLE_BG));
    if (noteStyleUlBtn) noteStyleUlBtn.addEventListener('click', () => setNoteModalStyle(ANNOTATION_STYLE_UL));

    if (selectionToolbar) {
        selectionToolbar.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });
        selectionToolbar.addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            const ctx = selectionContext;
            if (!ctx) return;

            hideAnnoMenu();

            if (action === 'copy') {
                const ok = await copyToClipboard(ctx.text);
                showToast(ok ? t('reader.copy_success') : t('reader.copy_failed'));
                hideSelectionToolbar();
                return;
            }

            if (action === 'note') {
                if (ctx.error === 'multi_block') {
                    showToast(t('reader.annotation_single_paragraph_only'));
                    return;
                }
                if (ctx.error) return;
                hideSelectionToolbar();
                openNoteModal({ mode: 'create', annoId: null, context: ctx, style: ANNOTATION_STYLE_BG });
                return;
            }

            if (action === 'highlight' || action === 'underline') {
                hideSelectionToolbar();
                try {
                    await createAnnotationFromContext(ctx, {
                        style: action === 'underline' ? ANNOTATION_STYLE_UL : ANNOTATION_STYLE_BG
                    });
                    clearTextSelection();
                } catch (err) {
                    console.warn(err);
                    showToast(t('reader.annotation_save_failed'));
                }
            }
        });
    }

    let selectionChangeTimer = null;
    document.addEventListener('selectionchange', () => {
        if (noteModal && noteModal.classList.contains('show')) return;
        if (notesModal && notesModal.classList.contains('show')) return;
        if (selectionChangeTimer) window.clearTimeout(selectionChangeTimer);
        selectionChangeTimer = window.setTimeout(() => updateSelectionUI(), 80);
    });

    if (contentViewer) {
        contentViewer.addEventListener('mouseup', () => {
            if (noteModal && noteModal.classList.contains('show')) return;
            if (notesModal && notesModal.classList.contains('show')) return;
            window.setTimeout(() => updateSelectionUI(), 0);
        });

        contentViewer.addEventListener('touchend', () => {
            if (noteModal && noteModal.classList.contains('show')) return;
            if (notesModal && notesModal.classList.contains('show')) return;
            window.setTimeout(() => updateSelectionUI(), 0);
        }, { passive: true });

        contentViewer.addEventListener('click', (e) => {
            const span = e.target.closest('span.anno[data-anno-id]');
            if (!span) return;
            if (hasActiveTextSelectionInContent()) return;
            e.preventDefault();
            e.stopPropagation();
            hideSelectionToolbar();
            openAnnoMenuForSpan(span);
        });
    }

    if (annoMenu) {
        annoMenu.addEventListener('click', async (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            const anno = activeAnnoId ? findAnnotationById(activeAnnoId) : null;
            if (!anno) {
                hideAnnoMenu();
                return;
            }

            if (action === 'toggle-style') {
                const nextStyle =
                    normalizeAnnotationStyle(anno.style) === ANNOTATION_STYLE_UL ? ANNOTATION_STYLE_BG : ANNOTATION_STYLE_UL;
                try {
                    const updated = await apiUpdateAnnotation(anno.id, { style: nextStyle });
                    const idx = annotations.findIndex(a => a && a.id === anno.id);
                    if (idx !== -1) annotations[idx] = updated;
                    const spans = Array.from(contentViewer.querySelectorAll(`span.anno[data-anno-id="${CSS.escape(anno.id)}"]`));
                    spans.forEach(s => {
                        s.classList.toggle('anno-ul', normalizeAnnotationStyle(updated.style) === ANNOTATION_STYLE_UL);
                        s.classList.toggle('anno-bg', normalizeAnnotationStyle(updated.style) !== ANNOTATION_STYLE_UL);
                        s.dataset.style = updated.style;
                    });
                } catch (err) {
                    console.warn(err);
                    showToast(t('reader.annotation_update_failed'));
                } finally {
                    hideAnnoMenu();
                }
                return;
            }

            if (action === 'edit-note') {
                hideAnnoMenu();
                openNoteModal({
                    mode: 'edit',
                    annoId: anno.id,
                    context: { text: anno.text || '' },
                    style: anno.style
                });
                return;
            }

            if (action === 'delete') {
                try {
                    await apiDeleteAnnotation(anno.id);
                    annotations = annotations.filter(a => a && a.id !== anno.id);
                    const spans = Array.from(contentViewer.querySelectorAll(`span.anno[data-anno-id="${CSS.escape(anno.id)}"]`));
                    spans.forEach(unwrapElement);
                    renderNotesList();
                } catch (err) {
                    console.warn(err);
                    showToast(t('reader.annotation_delete_failed'));
                } finally {
                    hideAnnoMenu();
                }
            }
        });
    }

    document.addEventListener('mousedown', (e) => {
        if (selectionToolbar && selectionToolbar.classList.contains('show') && !selectionToolbar.contains(e.target)) {
            if (!contentViewer.contains(e.target)) hideSelectionToolbar();
        }

        if (annoMenu && annoMenu.classList.contains('show')) {
            if (annoMenu.contains(e.target)) return;
            const onAnno = e.target.closest && e.target.closest('span.anno[data-anno-id]');
            if (!onAnno) hideAnnoMenu();
        }
    });

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
        scheduleProgressIndicatorUpdate();
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') scheduleProgressSave(true, { updateLastReadAt: true });
    });
    window.addEventListener('beforeunload', () => scheduleProgressSave(true, { updateLastReadAt: true }));
    window.addEventListener('resize', () => scheduleProgressIndicatorUpdate());

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
