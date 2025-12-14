(function () {
  const STORAGE_KEY = 'ui_lang';
  const supported = ['en', 'zh-CN', 'ja'];

  function normalizeLang(lang) {
    if (!lang) return null;
    const raw = String(lang).trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();

    if (lower === 'en' || lower.startsWith('en-')) return 'en';
    if (lower === 'ja' || lower.startsWith('ja-')) return 'ja';

    if (lower === 'zh' || lower.startsWith('zh-')) {
      if (lower.includes('hans') || lower.includes('cn') || lower.includes('sg')) return 'zh-CN';
      if (lower.includes('hant') || lower.includes('tw') || lower.includes('hk') || lower.includes('mo')) return 'zh-CN';
      return 'zh-CN';
    }

    return null;
  }

  const dictionaries = {
    en: {
      'app.name': 'EPUB Reader',
      'common.language': 'Language',
      'common.add': 'Add',
      'common.cancel': 'Cancel',
      'common.save': 'Save',
      'common.upload': 'Upload',
      'common.close': 'Close',
      'common.selected': 'Selected:',

      'library.page_title': 'EPUB Reader Library',
      'library.import_epub': 'Import EPUB',
      'library.toggle_dark_mode': 'Toggle Dark Mode',
      'library.categories': 'Categories',
      'library.all_books': 'All Books',
      'library.sort_by': 'Sort by:',
      'library.sort_title': 'Title',
      'library.sort_author': 'Author',
      'library.view_grid': 'Grid View',
      'library.view_list': 'List View',
      'library.recent_first': 'Recent first',
      'library.reading_progress_percent': 'Read {percent}%',
      'library.reading_progress_percent_chapter': 'Read {percent}% · {chapter}',
      'library.reading_progress_chapter': 'Last: {chapter}',
      'library.reading_progress_chapter_index': 'Chapter {index}',

      'library.import_options': 'Import Options',
      'library.selected_file': 'Selected File:',
      'library.add_category_tag_placeholder': 'Add a category tag (e.g., Literature)...',
      'library.suggested_tags': 'Suggested Tags:',
      'library.importing_book': 'Importing Book...',
      'library.uploading_and_processing': 'Uploading and processing...',
      'library.uploading': 'Uploading...',
      'library.waiting_server': 'Upload complete, waiting for server response...',

      'library.edit_categories': 'Edit Categories',
      'library.add_category_placeholder': 'Add a category...',
      'library.available_tags': 'Available Tags:',

      'library.file_protocol_error_html':
        'You are viewing this file directly via file://. This application requires a web server to function correctly (due to CORS policies).<br>Please run <code>python3 server.py</code> and visit <a href="http://localhost:8000">http://localhost:8000</a>.',
      'library.could_not_load_prefix': 'Could not load library. Ensure server.py is running.',
      'library.failed_fetch_books': 'Failed to fetch books: {status}',
      'library.no_books_found': 'No books found. Import one!',
      'library.no_other_existing_tags': 'No other existing tags.',
      'library.no_other_suggestions': 'No other suggestions available.',
      'library.failed_save_categories': 'Failed to save categories.',
      'library.error_save_categories': 'Error saving categories.',
      'library.starting_upload': 'Starting upload...',
      'library.import_success': 'Import Successful!',
      'library.import_failed': 'Import Failed: {error}',
      'library.unknown_error': 'Unknown error',
      'library.network_error': 'Network Error',
      'library.delete_confirm': 'Are you sure you want to delete "{name}"? This cannot be undone.',
      'library.book_deleted': 'Book deleted successfully!',
      'library.failed_delete_book': 'Failed to delete book: {error}',
      'library.error_deleting_book': 'An error occurred while trying to delete the book.',
      'library.uncategorized': 'Uncategorized',
      'library.delete_book': 'Delete Book',

      'reader.page_title': 'EPUB Reader',
      'reader.back_to_library': 'Back to Library',
      'reader.toggle_sidebar': 'Toggle Sidebar',
      'reader.loading': 'Loading...',
      'reader.decrease_font': 'Decrease Font Size',
      'reader.increase_font': 'Increase Font Size',
      'reader.change_font': 'Change Font',
      'reader.narrower_text': 'Narrower Text',
      'reader.wider_text': 'Wider Text',
      'reader.toggle_theme': 'Toggle Theme',
      'reader.tap_to_toggle_toolbars': 'Tap to show/hide toolbars',
      'reader.typography': 'Typography',
      'reader.font': 'Font',
      'reader.margin': 'Margin',
      'reader.line_height': 'Line Height',
      'reader.decrease_line_height': 'Decrease Line Height',
      'reader.increase_line_height': 'Increase Line Height',
      'reader.toc': 'Table of Contents',
      'reader.prev': 'Previous',
      'reader.next': 'Next',
      'reader.no_book_specified': 'No book specified.',
      'reader.no_chapters_error': 'Error: No chapters found.',
      'reader.error_loading_book': 'Error loading book: {message}',
      'reader.error_generic': 'Error: {message}',
      'reader.width_toast': 'Width: {px}px',
      'reader.font_toast': 'Font: {profile}',
      'reader.change_font_current': 'Change Font (Current: {profile})',

      'reader.notes': 'Notes',
      'reader.notes_title': 'Notes',
      'reader.no_notes': 'No notes yet.',
      'reader.note_title': 'Thoughts',
      'reader.note_placeholder': 'Write your thoughts...',

      'reader.annot_highlight': 'Highlight',
      'reader.annot_underline': 'Underline',
      'reader.annot_copy': 'Copy',
      'reader.annot_note': 'Note',
      'reader.annot_delete': 'Delete',
      'reader.annot_add_note': 'Add Note',
      'reader.annot_edit_note': 'Edit Note',
      'reader.annot_switch_to_highlight': 'Switch to Highlight',
      'reader.annot_switch_to_underline': 'Switch to Underline',

      'reader.annotation_single_paragraph_only': 'Please select within a single paragraph.',
      'reader.annotation_overlap_not_supported': 'Overlapping highlights are not supported yet.',
      'reader.annotation_save_failed': 'Failed to save highlight.',
      'reader.annotation_update_failed': 'Failed to update highlight.',
      'reader.annotation_delete_failed': 'Failed to delete highlight.',
      'reader.copy_success': 'Copied.',
      'reader.copy_failed': 'Copy failed.'
    },
    'zh-CN': {
      'app.name': 'EPUB 阅读器',
      'common.language': '语言',
      'common.add': '添加',
      'common.cancel': '取消',
      'common.save': '保存',
      'common.upload': '上传',
      'common.close': '关闭',
      'common.selected': '已选择：',

      'library.page_title': 'EPUB 阅读器书库',
      'library.import_epub': '导入 EPUB',
      'library.toggle_dark_mode': '切换深色模式',
      'library.categories': '分类',
      'library.all_books': '全部图书',
      'library.sort_by': '排序：',
      'library.sort_title': '书名',
      'library.sort_author': '作者',
      'library.view_grid': '网格视图',
      'library.view_list': '列表视图',
      'library.recent_first': '最近阅读优先',
      'library.reading_progress_percent': '读到 {percent}%',
      'library.reading_progress_percent_chapter': '读到 {percent}% · {chapter}',
      'library.reading_progress_chapter': '上次：{chapter}',
      'library.reading_progress_chapter_index': '第{index}章',

      'library.import_options': '导入选项',
      'library.selected_file': '已选择文件：',
      'library.add_category_tag_placeholder': '添加分类标签（例如：文学）…',
      'library.suggested_tags': '建议标签：',
      'library.importing_book': '正在导入…',
      'library.uploading_and_processing': '正在上传并处理…',
      'library.uploading': '正在上传…',
      'library.waiting_server': '上传完成，等待服务器响应…',

      'library.edit_categories': '编辑分类',
      'library.add_category_placeholder': '添加分类…',
      'library.available_tags': '可用标签：',

      'library.file_protocol_error_html':
        '你正在通过 file:// 直接打开此文件。由于浏览器的 CORS 限制，本应用需要通过 Web 服务器运行。<br>请运行 <code>python3 server.py</code> 并访问 <a href="http://localhost:8000">http://localhost:8000</a>。',
      'library.could_not_load_prefix': '无法加载书库，请确认 server.py 正在运行。',
      'library.failed_fetch_books': '获取图书列表失败：{status}',
      'library.no_books_found': '未找到图书，先导入一本吧！',
      'library.no_other_existing_tags': '没有其他已有标签。',
      'library.no_other_suggestions': '没有其他可用建议。',
      'library.failed_save_categories': '保存分类失败。',
      'library.error_save_categories': '保存分类时出错。',
      'library.starting_upload': '开始上传…',
      'library.import_success': '导入成功！',
      'library.import_failed': '导入失败：{error}',
      'library.unknown_error': '未知错误',
      'library.network_error': '网络错误',
      'library.delete_confirm': '确定要删除“{name}”吗？此操作无法撤销。',
      'library.book_deleted': '图书已删除！',
      'library.failed_delete_book': '删除失败：{error}',
      'library.error_deleting_book': '删除图书时发生错误。',
      'library.uncategorized': '未分类',
      'library.delete_book': '删除图书',

      'reader.page_title': 'EPUB 阅读器',
      'reader.back_to_library': '返回书库',
      'reader.toggle_sidebar': '切换目录栏',
      'reader.loading': '加载中…',
      'reader.decrease_font': '减小字号',
      'reader.increase_font': '增大字号',
      'reader.change_font': '切换字体',
      'reader.narrower_text': '缩窄正文宽度',
      'reader.wider_text': '加宽正文宽度',
      'reader.toggle_theme': '切换主题',
      'reader.tap_to_toggle_toolbars': '轻点屏幕显示/隐藏工具栏',
      'reader.typography': '排版',
      'reader.font': '字体',
      'reader.margin': '边距',
      'reader.line_height': '行距',
      'reader.decrease_line_height': '减小行距',
      'reader.increase_line_height': '增大行距',
      'reader.toc': '目录',
      'reader.prev': '上一章',
      'reader.next': '下一章',
      'reader.no_book_specified': '未指定图书。',
      'reader.no_chapters_error': '错误：未找到章节。',
      'reader.error_loading_book': '加载图书失败：{message}',
      'reader.error_generic': '错误：{message}',
      'reader.width_toast': '宽度：{px}px',
      'reader.font_toast': '字体：{profile}',
      'reader.change_font_current': '切换字体（当前：{profile}）',

      'reader.notes': '笔记',
      'reader.notes_title': '笔记',
      'reader.no_notes': '暂无笔记',
      'reader.note_title': '写想法',
      'reader.note_placeholder': '写下你的想法…',

      'reader.annot_highlight': '高亮',
      'reader.annot_underline': '下划线',
      'reader.annot_copy': '复制',
      'reader.annot_note': '想法',
      'reader.annot_delete': '删除',
      'reader.annot_add_note': '写想法',
      'reader.annot_edit_note': '编辑想法',
      'reader.annot_switch_to_highlight': '切换为高亮',
      'reader.annot_switch_to_underline': '切换为下划线',

      'reader.annotation_single_paragraph_only': '暂只支持单段落内划线',
      'reader.annotation_overlap_not_supported': '暂不支持重叠划线',
      'reader.annotation_save_failed': '保存划线失败',
      'reader.annotation_update_failed': '更新划线失败',
      'reader.annotation_delete_failed': '删除划线失败',
      'reader.copy_success': '已复制',
      'reader.copy_failed': '复制失败'
    },
    ja: {
      'app.name': 'EPUB リーダー',
      'common.language': '言語',
      'common.add': '追加',
      'common.cancel': 'キャンセル',
      'common.save': '保存',
      'common.upload': 'アップロード',
      'common.close': '閉じる',
      'common.selected': '選択中：',

      'library.page_title': 'EPUB リーダー ライブラリ',
      'library.import_epub': 'EPUB をインポート',
      'library.toggle_dark_mode': 'ダークモード切替',
      'library.categories': 'カテゴリ',
      'library.all_books': 'すべての本',
      'library.sort_by': '並び替え：',
      'library.sort_title': 'タイトル',
      'library.sort_author': '著者',
      'library.view_grid': 'グリッド表示',
      'library.view_list': 'リスト表示',
      'library.recent_first': '最近読んだ順',
      'library.reading_progress_percent': '進捗 {percent}%',
      'library.reading_progress_percent_chapter': '進捗 {percent}% ・ {chapter}',
      'library.reading_progress_chapter': '前回：{chapter}',
      'library.reading_progress_chapter_index': '第{index}章',

      'library.import_options': 'インポート設定',
      'library.selected_file': '選択したファイル：',
      'library.add_category_tag_placeholder': 'カテゴリタグを追加（例：文学）…',
      'library.suggested_tags': '候補タグ：',
      'library.importing_book': 'インポート中…',
      'library.uploading_and_processing': 'アップロードして処理中…',
      'library.uploading': 'アップロード中…',
      'library.waiting_server': 'アップロード完了。サーバー応答待ち…',

      'library.edit_categories': 'カテゴリ編集',
      'library.add_category_placeholder': 'カテゴリを追加…',
      'library.available_tags': '利用可能なタグ：',

      'library.file_protocol_error_html':
        'file:// で直接開いています。CORS の制限により、このアプリは Web サーバー経由での実行が必要です。<br><code>python3 server.py</code> を実行し、<a href="http://localhost:8000">http://localhost:8000</a> にアクセスしてください。',
      'library.could_not_load_prefix': 'ライブラリを読み込めません。server.py が起動しているか確認してください。',
      'library.failed_fetch_books': '本の取得に失敗しました：{status}',
      'library.no_books_found': '本が見つかりません。まずはインポートしてください！',
      'library.no_other_existing_tags': '他の既存タグはありません。',
      'library.no_other_suggestions': '他の候補はありません。',
      'library.failed_save_categories': 'カテゴリの保存に失敗しました。',
      'library.error_save_categories': 'カテゴリの保存中にエラーが発生しました。',
      'library.starting_upload': 'アップロードを開始…',
      'library.import_success': 'インポート成功！',
      'library.import_failed': 'インポート失敗：{error}',
      'library.unknown_error': '不明なエラー',
      'library.network_error': 'ネットワークエラー',
      'library.delete_confirm': '「{name}」を削除しますか？この操作は元に戻せません。',
      'library.book_deleted': '削除しました！',
      'library.failed_delete_book': '削除に失敗しました：{error}',
      'library.error_deleting_book': '削除中にエラーが発生しました。',
      'library.uncategorized': '未分類',
      'library.delete_book': '本を削除',

      'reader.page_title': 'EPUB リーダー',
      'reader.back_to_library': 'ライブラリへ戻る',
      'reader.toggle_sidebar': 'サイドバー切替',
      'reader.loading': '読み込み中…',
      'reader.decrease_font': '文字サイズを小さく',
      'reader.increase_font': '文字サイズを大きく',
      'reader.change_font': 'フォント切替',
      'reader.narrower_text': '本文幅を狭く',
      'reader.wider_text': '本文幅を広く',
      'reader.toggle_theme': 'テーマ切替',
      'reader.tap_to_toggle_toolbars': '画面をタップしてツールバーを表示/非表示',
      'reader.typography': '表示設定',
      'reader.font': 'フォント',
      'reader.margin': '余白',
      'reader.line_height': '行間',
      'reader.decrease_line_height': '行間を狭く',
      'reader.increase_line_height': '行間を広く',
      'reader.toc': '目次',
      'reader.prev': '前へ',
      'reader.next': '次へ',
      'reader.no_book_specified': '本が指定されていません。',
      'reader.no_chapters_error': 'エラー：章が見つかりません。',
      'reader.error_loading_book': '読み込みに失敗しました：{message}',
      'reader.error_generic': 'エラー：{message}',
      'reader.width_toast': '幅：{px}px',
      'reader.font_toast': 'フォント：{profile}',
      'reader.change_font_current': 'フォント切替（現在：{profile}）',

      'reader.notes': 'ノート',
      'reader.notes_title': 'ノート',
      'reader.no_notes': 'まだノートはありません。',
      'reader.note_title': 'メモ',
      'reader.note_placeholder': '考えを書いてください…',

      'reader.annot_highlight': 'ハイライト',
      'reader.annot_underline': '下線',
      'reader.annot_copy': 'コピー',
      'reader.annot_note': 'メモ',
      'reader.annot_delete': '削除',
      'reader.annot_add_note': 'メモを書く',
      'reader.annot_edit_note': 'メモを編集',
      'reader.annot_switch_to_highlight': 'ハイライトに切替',
      'reader.annot_switch_to_underline': '下線に切替',

      'reader.annotation_single_paragraph_only': '1段落内で選択してください。',
      'reader.annotation_overlap_not_supported': '重なったハイライトは未対応です。',
      'reader.annotation_save_failed': 'ハイライトの保存に失敗しました。',
      'reader.annotation_update_failed': 'ハイライトの更新に失敗しました。',
      'reader.annotation_delete_failed': 'ハイライトの削除に失敗しました。',
      'reader.copy_success': 'コピーしました。',
      'reader.copy_failed': 'コピーできませんでした。'
    }
  };

  function interpolate(template, vars) {
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (_, key) => {
      const value = vars[key];
      return value === undefined || value === null ? '' : String(value);
    });
  }

  function t(key, vars) {
    const dict = dictionaries[currentLang] || dictionaries.en;
    const fallback = dictionaries.en || {};
    const template = dict[key] ?? fallback[key] ?? key;
    return interpolate(String(template), vars);
  }

  function apply(root = document) {
    const scope = root instanceof Document ? root : root.ownerDocument || document;
    const elements = (root instanceof Document ? root : root).querySelectorAll
      ? (root instanceof Document ? root : root).querySelectorAll('[data-i18n], [data-i18n-title], [data-i18n-placeholder], [data-i18n-aria-label]')
      : [];

    elements.forEach((el) => {
      const textKey = el.getAttribute('data-i18n');
      if (textKey) el.textContent = t(textKey);

      const titleKey = el.getAttribute('data-i18n-title');
      if (titleKey) el.setAttribute('title', t(titleKey));

      const placeholderKey = el.getAttribute('data-i18n-placeholder');
      if (placeholderKey) el.setAttribute('placeholder', t(placeholderKey));

      const ariaLabelKey = el.getAttribute('data-i18n-aria-label');
      if (ariaLabelKey) el.setAttribute('aria-label', t(ariaLabelKey));
    });

    scope.documentElement.setAttribute('lang', currentLang);
  }

  function setLang(lang) {
    const normalized = normalizeLang(lang) || 'en';
    if (normalized === currentLang) return;
    currentLang = normalized;
    try {
      localStorage.setItem(STORAGE_KEY, currentLang);
    } catch {}
    apply(document);
    window.dispatchEvent(new CustomEvent('ui-language-changed', { detail: { lang: currentLang } }));
  }

  function getLang() {
    return currentLang;
  }

  function initLangSelect() {
    const select = document.getElementById('lang-select');
    if (!select) return;

    select.innerHTML = '';
    const options = [
      { value: 'en', label: 'English' },
      { value: 'zh-CN', label: '简体中文' },
      { value: 'ja', label: '日本語' }
    ];

    options.forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      select.appendChild(opt);
    });

    select.value = currentLang;
    select.setAttribute('aria-label', t('common.language'));
    select.addEventListener('change', () => setLang(select.value));

    window.addEventListener('ui-language-changed', () => {
      select.value = currentLang;
      select.setAttribute('aria-label', t('common.language'));
    });
  }

  function detectInitialLang() {
    try {
      const stored = normalizeLang(localStorage.getItem(STORAGE_KEY));
      if (stored && supported.includes(stored)) return stored;
    } catch {}

    const navigatorLangs = Array.isArray(navigator.languages) ? navigator.languages : [];
    for (const l of navigatorLangs) {
      const normalized = normalizeLang(l);
      if (normalized && supported.includes(normalized)) return normalized;
    }

    const normalized = normalizeLang(navigator.language);
    if (normalized && supported.includes(normalized)) return normalized;
    return 'en';
  }

  let currentLang = detectInitialLang();

  window.I18N = { t, apply, setLang, getLang, supported };

  document.addEventListener('DOMContentLoaded', () => {
    apply(document);
    initLangSelect();
  });
})();
