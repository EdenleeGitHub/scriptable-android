(function () {
  'use strict';
  const paths = {
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    spark: '<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z"/><path d="m20 2 .7 2.3L23 5l-2.3.7L20 8l-.7-2.3L17 5l2.3-.7L20 2Z"/>',
    book: '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1V5Z"/><path d="M6 8h3m6 0h3M6 12h3m6 0h3"/>',
    settings: '<path d="m9 3-.8 2.3-2 .8L4 5.4 2 9l1.8 1.6v2.8L2 15l2 3.6 2.2-.7 2 .8L9 21h4l.8-2.3 2-.8 2.2.7 2-3.6-1.8-1.6v-2.8L20 9l-2-3.6-2.2.7-2-.8L13 3H9Z"/><circle cx="11" cy="12" r="3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    back: '<path d="m14 5-7 7 7 7"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    play: '<path d="m8 4 12 8-12 8V4Z"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',
    device: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4m-3 14h2"/>',
    folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
    cloud: '<path d="M6 18a5 5 0 1 1 1-10 6 6 0 0 1 11 2 4 4 0 0 1 0 8H6Z"/>',
    note: '<path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9M15 3l6 6M7 8h3m-3 5h9m-9 4h6"/>',
    clipboard: '<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="8" y="2" width="8" height="5" rx="1"/><path d="M9 12h6m-6 4h4"/>',
    terminal: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m6 8 4 4-4 4m7 0h5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
    moon: '<path d="M20 14a8.5 8.5 0 1 1-10-10 7 7 0 0 0 10 10Z"/>',
    bell: '<path d="M5 16c2-2 1-5 2-8a5 5 0 0 1 10 0c1 3 0 6 2 8H5Zm5 4h4"/>',
    heart: '<path d="M12 20 3 11a5 5 0 0 1 9-6 5 5 0 0 1 9 6l-9 9Z"/>',
    bolt: '<path d="m14 2-10 12h7l-1 8 10-12h-7l1-8Z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18m-14 4h2m4 0h2m-8 3h2"/>',
    layers: '<path d="m12 3 10 6-10 6L2 9l10-6Zm-10 12 10 6 10-6M2 12l10 6 10-6"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    edit: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.2"/>',
    font: '<path d="m4 20 7-16h2l7 16M7 14h10"/>',
    external: '<path d="M14 3h7v7m0-7L11 13M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
    widget: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M7 8h10m-10 4h5m-5 4h3"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    sync: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>'
  };
  const colors = ['#6370ee', '#46a6bd', '#ed9461', '#af80d7', '#71ac87', '#df7e99', '#668bc6', '#ad9b60'];
  const scriptIcons = ['code', 'globe', 'device', 'folder', 'cloud', 'note', 'clipboard', 'terminal', 'sun', 'bell', 'heart', 'bolt', 'calendar', 'layers', 'widget', 'lock', 'spark', 'book', 'moon', 'settings', 'grid'];
  const state = { tab: 'scripts', scripts: [], examples: [], docs: [], settings: { theme: 'auto', fontSize: 13 }, device: {}, query: '', sort: 'updated', currentId: null, runId: null, runState: 'idle', logs: [], widget: null, preview: null, outputTab: 'console', outputOpen: false, saveTimer: null, toastTimer: null };
  const main = document.getElementById('main');
  const nav = document.getElementById('bottom-nav');
  const modalRoot = document.getElementById('modal-root');
  const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
  const icon = (name, extra) => '<svg class="icon ' + (extra || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || paths.code) + '</svg>';
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const validColor = value => /^#[0-9a-f]{3,8}$/i.test(value || '') ? value : colors[0];
  const getScript = id => state.scripts.find(item => item.id === id);
  const native = () => Boolean(window.Host && Host.isNative);
  const uniqueId = () => 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  function cleanScript(data) {
    if (!data || typeof data.code !== 'string') throw new Error('未找到有效的 JavaScript 脚本');
    return { id: String(data.id || uniqueId()), name: String(data.name || '未命名脚本').slice(0, 100), code: data.code, color: validColor(data.color), icon: paths[data.icon] ? data.icon : 'code', updatedAt: Number(data.updatedAt) || Date.now() };
  }
  function hostSync(action, payload) {
    if (!window.Host || typeof Host.sync !== 'function') throw new Error('应用连接未就绪');
    return Host.sync(action, payload || {});
  }
  function hostCall(action, payload) {
    if (!window.Host || typeof Host.call !== 'function') return Promise.reject(new Error('应用连接未就绪'));
    return Host.call(action, payload || {});
  }
  function notify(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }
  function applySettings() {
    document.documentElement.dataset.theme = state.settings.theme === 'auto' ? (themeMedia.matches ? 'dark' : 'light') : state.settings.theme;
    document.documentElement.style.setProperty('--editor-size', state.settings.fontSize + 'px');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = document.documentElement.dataset.theme === 'dark' ? '#141925' : '#f7f8fc';
    if(window.Host?.isNative)Host.call('ui.theme',{dark:document.documentElement.dataset.theme==='dark'}).catch(()=>{});
  }
  themeMedia.addEventListener ? themeMedia.addEventListener('change', applySettings) : themeMedia.addListener(applySettings);
  function navRender() {
    const tabs = [['scripts', 'grid', '脚本'], ['examples', 'spark', '示例'], ['docs', 'book', '文档'], ['settings', 'settings', '设置']];
    nav.innerHTML = tabs.map(([id, symbol, label]) => '<button class="nav-item' + (state.tab === id ? ' active' : '') + '" data-tab="' + id + '" aria-current="' + (state.tab === id ? 'page' : 'false') + '"><span class="nav-icon">' + icon(symbol) + '</span><span>' + label + '</span></button>').join('');
    nav.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => navigate(button.dataset.tab));
  }
  function top(title, subtitle, action) {
    return '<div class="top-brand"><span class="brand-mark"><img src="brand/app-icon-v2.png" width="34" height="34" alt="" decoding="async"></span><span class="brand-name">SCRIPTABLE <span>ANDROID</span></span><span class="edition-pill">v0.2</span></div><div class="top-head"><div><h1>' + title + '</h1><p class="subtitle">' + subtitle + '</p></div>' + (action || '') + '</div>';
  }
  function navigate(tab) {
    if (!flushSave()) return false;
    state.currentId = null;
    state.tab = tab;
    document.getElementById('app').classList.remove('editor-mode');
    document.body.classList.remove('editing');
    closeModal();
    navRender();
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    if (state.currentId) return renderEditor();
    if (state.tab === 'examples') return renderExamples();
    if (state.tab === 'docs') return renderDocs();
    if (state.tab === 'settings') return renderSettings();
    renderScripts();
  }
  function relativeTime(timestamp) {
    const diff = Math.max(0, Date.now() - timestamp);
    if (diff < 60 * 1000) return '刚刚编辑';
    if (diff < 3600 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 7 * 86400 * 1000) return Math.floor(diff / 86400000) + ' 天前';
    return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  }
  function card(script) {
    return '<article class="script-card" style="--card-color:' + validColor(script.color) + '"><button class="card-open" data-open="' + escape(script.id) + '" aria-label="编辑 ' + escape(script.name) + '"><span class="card-icon">' + icon(script.icon) + '</span><span class="card-title">' + escape(script.name) + '</span><span class="card-meta">' + relativeTime(script.updatedAt) + '</span></button><div class="card-actions"><span class="card-tag">JAVASCRIPT</span><div class="card-action-group"><button class="icon-button" data-options="' + escape(script.id) + '" aria-label="' + escape(script.name) + ' 的更多选项">' + icon('more') + '</button><button class="icon-button card-run" data-run="' + escape(script.id) + '" aria-label="运行 ' + escape(script.name) + '">' + icon('play') + '</button></div></div></article>';
  }
  function renderScripts() {
    main.innerHTML = '<section class="page">' + top('我的脚本', '一点 JavaScript，让日常更简单。', '<button id="add-script" class="add-button" aria-label="新建脚本">' + icon('plus') + '</button>') + '<div class="toolbar"><label class="search-wrap">' + icon('search') + '<input id="script-search" type="search" placeholder="搜索你的脚本" aria-label="搜索脚本" value="' + escape(state.query) + '"></label><select class="sort-select" id="script-sort" aria-label="脚本排序"><option value="updated">最近编辑</option><option value="name">按名称</option><option value="created">创建顺序</option></select><button id="import-script" class="sort-button" aria-label="导入 JavaScript 文件" title="导入脚本">' + icon('download') + '</button></div><div class="section-line"><span class="section-eyebrow">YOUR COLLECTION</span><span id="script-count" class="section-count"></span></div><div id="scripts-grid" class="scripts-grid"></div><div class="getting-started"><span class="hint-icon">' + icon('bolt') + '</span><div><h3>从一个小想法开始</h3><p>查看可运行的示例，写下你的第一个脚本。</p></div><button id="explore-examples" class="text-button">探索示例' + icon('arrow') + '</button></div><p class="footer-caption">CREATED BY YOU · POWERED BY JAVASCRIPT</p></section>';
    document.getElementById('script-search').oninput = event => { state.query = event.target.value; updateCards(); };
    document.getElementById('script-sort').value = state.sort;
    document.getElementById('script-sort').onchange = event => { state.sort = event.target.value; updateCards(); };
    document.getElementById('add-script').onclick = () => scriptProperties(null);
    document.getElementById('import-script').onclick = importScript;
    document.getElementById('explore-examples').onclick = () => navigate('examples');
    updateCards();
  }
  function updateCards() {
    const list = state.scripts.filter(script => script.name.toLowerCase().includes(state.query.trim().toLowerCase()));
    if (state.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    if (state.sort === 'updated') list.sort((a, b) => b.updatedAt - a.updatedAt);
    document.getElementById('script-count').textContent = list.length + ' 个脚本';
    const grid = document.getElementById('scripts-grid');
    grid.innerHTML = list.length ? list.map(card).join('') : '<div class="empty-state">' + icon(state.query ? 'search' : 'code') + '<h3>' + (state.query ? '没有找到脚本' : '你的想法，从这里开始') + '</h3><p>' + (state.query ? '试试其他关键词。' : '新建脚本，或从示例中挑选一个。') + '</p>' + (state.query ? '' : '<button class="primary-button" id="empty-add">' + icon('plus') + '新建脚本</button>') + '</div>';
    grid.querySelectorAll('[data-open]').forEach(button => button.onclick = () => openScript(button.dataset.open));
    grid.querySelectorAll('[data-options]').forEach(button => button.onclick = () => scriptMenu(button.dataset.options));
    grid.querySelectorAll('[data-run]').forEach(button => button.onclick = () => openScript(button.dataset.run, true));
    if (document.getElementById('empty-add')) document.getElementById('empty-add').onclick = () => scriptProperties(null);
  }
  function renderExamples() {
    main.innerHTML = '<section class="page">' + top('灵感与示例', '无需从零开始，把灵感变成你的脚本。') + '<div class="gallery-hero"><div><h2>小脚本，大用途。</h2><p>读取文件、请求数据、创建小组件。<br>导入后即可编辑与运行。</p></div><span class="hero-code">{ }</span></div><div class="section-line"><span class="section-eyebrow">MADE TO EXPLORE</span><span class="section-count">' + state.examples.length + ' 个示例</span></div><div class="example-grid">' + state.examples.map((item, index) => '<article class="example-card" style="--card-color:' + validColor(item.color) + '"><div class="example-title"><span class="card-icon" style="color:' + validColor(item.color) + ';background:color-mix(in srgb,' + validColor(item.color) + ' 12%,var(--surface))">' + icon(item.icon) + '</span><h3>' + escape(item.name) + '</h3></div><p>' + escape(item.description || '') + '</p><div class="example-footer"><span class="pill">' + escape(item.category || '入门示例') + '</span><button class="import-example" data-example="' + index + '">' + icon('plus') + '导入脚本</button></div></article>').join('') + '</div><p class="small-note">示例会保存为独立副本，导入后由你点击运行。联网示例需要网络连接。</p></section>';
    main.querySelectorAll('[data-example]').forEach(button => button.onclick = () => {
      const example = state.examples[Number(button.dataset.example)];
      const script = cleanScript(Object.assign({}, example, { id: uniqueId(), updatedAt: Date.now(), name: uniqueName(example.name) }));
      if (saveScript(script)) { notify('已添加到我的脚本'); openScript(script.id); }
    });
  }
  function renderDocs() {
    main.innerHTML = '<section class="page">' + top('API 文档', '随手查阅，离线也能写脚本。') + '<div class="notice"><strong>Android 独立实现</strong><br>下面列出本应用实际支持的 API 与边界。兼容部分 Scriptable 写法；iOS 专属能力与完整官方 API 尚未实现。</div><div class="docs-list">' + state.docs.map((doc, index) => '<article class="doc-item" id="doc-' + index + '"><button class="doc-summary" data-doc="' + index + '" aria-expanded="false"><span class="doc-initial">' + escape(doc.name.slice(0, 2)) + '</span><span><span class="doc-name">' + escape(doc.name) + '</span><span class="doc-subtitle" style="display:block">' + escape(doc.description) + '</span></span>' + icon('down') + '</button><div class="doc-body"><p>' + escape(doc.detail || doc.description) + '</p><pre class="code-block">' + escape(doc.code) + '</pre><p class="doc-limit">' + escape(doc.limit || '') + '</p><button class="secondary-button doc-run" data-doc-copy="' + index + '">' + icon('code') + '创建示例脚本</button></div></article>').join('') + '</div><div class="notice" style="margin-top:19px"><strong>当前不支持</strong><br>Siri、iCloud、照片图库、日历、定位与 iOS 系统控件；桌面小组件暂不定时运行脚本。需要更新内容时，请重新运行并固定小组件。</div><a class="source-link" href="https://docs.scriptable.app/" target="_blank" rel="noopener noreferrer">原版 Scriptable 文档' + icon('external') + '</a></section>';
    const notices = main.querySelectorAll('.notice');
    if (notices[0]) notices[0].innerHTML = '<strong>脚本 API 与 Android 原生能力</strong><br>离线查阅示例与使用方法。各项说明列出实际支持范围、所需权限与平台差异。';
    if (notices[1]) notices[1].innerHTML = '<strong>跨平台适配</strong><br>系统交互遵循 Android；图标使用原创或开源替代，云文件通过系统文件选择器连接目录。桌面组件、权限和后台运行以设备中的实际设置为准。';
    if (notices[0]) notices[0].insertAdjacentHTML('beforebegin', '<label class="search-wrap docs-search">' + icon('search') + '<input id="doc-search" type="search" placeholder="搜索 API，例如 DrawContext" aria-label="搜索 API 文档"></label>');
    const search = document.getElementById('doc-search');
    state.docs.forEach((doc, index) => {
      const body = document.querySelector('#doc-' + index + ' .doc-body'); if (!body || !Array.isArray(doc.members)) return;
      const section = document.createElement('section'); section.className = 'doc-members';
      const heading = document.createElement('h3'); heading.textContent = '成员 · ' + doc.members.length; section.appendChild(heading);
      const members = document.createElement('div'); members.className = 'doc-member-grid';
      doc.members.forEach(member => { const token = document.createElement('code'); const kind = member.startsWith('+') ? 'static' : member.startsWith('-') ? 'method' : 'property'; token.className = 'doc-member ' + kind; token.textContent = member.startsWith('-new ') ? member.slice(1) + '()' : member.replace(/^[+-]/, '') + (kind === 'property' ? '' : '()'); token.title = kind === 'static' ? '静态方法' : kind === 'method' ? '实例方法' : '属性'; members.appendChild(token); });
      section.appendChild(members); body.insertBefore(section, body.querySelector('.code-block'));
    });
    if (search) search.oninput = () => { const query = search.value.trim().toLowerCase(); main.querySelectorAll('.doc-item').forEach(item => { item.hidden = query && !item.textContent.toLowerCase().includes(query); }); };
    main.querySelectorAll('[data-doc]').forEach(button => button.onclick = () => { const expanded = document.getElementById('doc-' + button.dataset.doc).classList.toggle('expanded'); button.setAttribute('aria-expanded', String(expanded)); });
    main.querySelectorAll('[data-doc-copy]').forEach(button => button.onclick = () => {
      const doc = state.docs[Number(button.dataset.docCopy)];
      const script = cleanScript({ id: uniqueId(), name: uniqueName(doc.name + ' 示例'), code: doc.code, color: colors[0], icon: 'book', updatedAt: Date.now() });
      if (saveScript(script)) openScript(script.id);
    });
  }
  function renderSettings() {
    main.innerHTML = '<section class="page settings-page">' + top('设置', '让这个小工具，更像你的。') + '<p class="settings-title">APPEARANCE · 外观</p><div class="settings-group"><div class="settings-row">' + icon('sun') + '<span class="settings-row-label">主题<small>选择你的工作空间配色</small></span><select id="theme-setting" aria-label="主题"><option value="auto">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></div><div class="settings-row">' + icon('font') + '<span class="settings-row-label">编辑器字号<small>舒适阅读，专注编写</small></span><select id="font-setting" aria-label="编辑器字号">' + [11, 12, 13, 14, 15, 16, 18, 20].map(size => '<option value="' + size + '">' + size + ' px</option>').join('') + '</select></div></div><p class="settings-title">YOUR SCRIPTS · 脚本</p><div class="settings-group"><div class="settings-row">' + icon('download') + '<span class="settings-row-label">导入 JavaScript<small>从本地 .js 文件创建一个新脚本</small></span><button id="settings-import">导入</button></div><div class="settings-row">' + icon('folder') + '<span class="settings-row-label">本地保存<small>脚本会自动保存在此设备；导出文件可备份</small></span><span class="pill">' + state.scripts.length + ' 个</span></div></div><p class="settings-title">ABOUT · 关于</p><div class="about-box"><span class="brand-mark">' + icon('code') + '</span><h3>Scriptable Android</h3><p>用 JavaScript 构建属于你的日常工具。<br>受 Scriptable 启发的 Android 独立实现，<br>与原版开发者无关联。</p><div class="about-version">0.1.0 · ANDROID EDITION</div></div><p class="small-note">支持脚本编辑、隔离执行、网络请求、本地文件、弹窗、预览与桌面小组件。浏览器预览中的系统能力受限，安装 Android 应用后可使用原生能力。</p><button id="show-limits" class="text-button" style="margin:10px auto">查看支持范围' + icon('arrow') + '</button></section>';
    const about = main.querySelector('.about-box');
    if (about) {
      about.previousElementSibling.insertAdjacentHTML('beforebegin', '<p class="settings-title">AUTOMATION · 自动化</p><div class="settings-group"><div class="settings-row">' + icon('widget') + '<span class="settings-row-label">刷新桌面小组件<small>运行已配置的组件脚本，更新主屏幕内容</small></span><button id="widget-refresh">刷新</button></div><div class="settings-row">' + icon('clock') + '<span class="settings-row-label">定时与后台运行<small>打开系统定时权限，管理后台刷新</small></span><button id="alarm-settings">设置</button></div></div><p class="settings-title">CLOUD · 云端与备份</p><div class="settings-group"><div class="settings-row">' + icon('cloud') + '<span class="settings-row-label">连接云目录<small>通过 Android 文件选择器连接云盘或本地文件夹</small></span><button id="cloud-connect">连接</button></div><div class="settings-row">' + icon('sync') + '<span class="settings-row-label">立即同步<small>同步已连接目录与应用中的文件副本</small></span><button id="cloud-sync">同步</button></div></div>');
      about.querySelector('.about-version').textContent = '0.2.1 · ANDROID EDITION';
      about.querySelector('.brand-mark').innerHTML = '<img src="brand/app-icon-v2.png" width="62" height="62" alt="Scriptable Android 图标" decoding="async">';
    }
    for (const [id, action, success] of [['cloud-connect', 'cloud.configure', '云盘设置已更新'], ['cloud-sync', 'cloud.sync', '同步完成'], ['widget-refresh', 'widget.refresh', '小组件已刷新'], ['alarm-settings', 'alarm.settings', '已打开系统定时设置']]) {
      const button = document.getElementById(id); if (!button) continue;
      button.onclick = async () => {
        if (!native()) return notify('安装 Android 应用后即可使用此功能');
        button.disabled = true;
        try { const result = await hostCall(action, {}); if (!result?.cancelled) notify(result?.message || success); }
        catch (error) { notify(error.message || '操作未完成，请重试'); }
        finally { button.disabled = false; }
      };
    }
    document.getElementById('theme-setting').value = state.settings.theme;
    document.getElementById('font-setting').value = String(state.settings.fontSize);
    const appearance = main.querySelector('.settings-group');
    if (appearance) { appearance.insertAdjacentHTML('beforeend', '<div class="settings-row">' + icon('code') + '<label class="settings-row-label" for="completion-setting">智能补全<small>根据 API 与简单变量类型提示，方向键选择后按回车插入</small></label><input id="completion-setting" class="setting-switch" type="checkbox" role="switch"></div>'); const toggle = document.getElementById('completion-setting'); toggle.checked = completionEnabled; toggle.onchange = () => { completionEnabled = toggle.checked; try { localStorage.setItem('scriptable-editor-completion-v2', completionEnabled ? 'on' : 'off'); } catch (_) {} if (!completionEnabled) hideCompletion(); }; }
    document.getElementById('theme-setting').onchange = event => setSettings({ theme: event.target.value });
    document.getElementById('font-setting').onchange = event => setSettings({ fontSize: Number(event.target.value) });
    document.getElementById('settings-import').onclick = importScript;
    document.getElementById('show-limits').onclick = () => navigate('docs');
  }
  function setSettings(change) {
    try {
      hostSync('settings.set', Object.assign({}, state.settings, change));
      Object.assign(state.settings, change);
      applySettings();
    } catch (error) { notify('设置保存失败：' + error.message); renderSettings(); }
  }
  function saveScript(script, quiet) {
    try {
      hostSync('repo.save', script);
      const index = state.scripts.findIndex(item => item.id === script.id);
      if (index < 0) state.scripts.push(script); else state.scripts[index] = script;
      return true;
    } catch (error) {
      if (!quiet) notify('保存失败：' + error.message);
      const status = document.getElementById('save-status');
      if (status) status.textContent = '保存失败，请重试';
      return false;
    }
  }
  function uniqueName(name) {
    if (!state.scripts.some(item => item.name === name)) return name;
    let counter = 2;
    while (state.scripts.some(item => item.name === name + ' ' + counter)) counter++;
    return name + ' ' + counter;
  }
  function openScript(id, run) {
    const script = getScript(id);
    if (!script) return false;
    if (!flushSave()) return false;
    closeModal();
    state.currentId = id;
    document.getElementById('app').classList.add('editor-mode');
    document.body.classList.add('editing');
    renderEditor();
    window.scrollTo(0, 0);
    if (run) runCurrent();
    return true;
  }
  function renderEditor() {
    const script = getScript(state.currentId);
    if (!script) return navigate('scripts');
    main.innerHTML = '<section class="editor-screen"><header class="editor-head"><button id="editor-back" class="editor-back" aria-label="返回脚本">' + icon('back') + '</button><div class="editor-title"><h2 id="editor-name">' + escape(script.name) + '</h2><div id="save-status" class="save-status"><span class="save-dot"></span>已自动保存</div></div><button id="editor-run" class="editor-run">' + icon('play') + '<span>运行</span></button><button id="editor-more" class="editor-more" aria-label="脚本选项">' + icon('more') + '</button></header><div class="editor-strip"><span class="script-language"><span class="js-dot"></span>JavaScript</span><span id="cursor-position">Ln 1, Col 1</span></div><div class="editor-area"><div class="line-numbers" aria-hidden="true"><div id="line-number-content" class="line-number-content"></div></div><textarea id="code-input" class="code-input" spellcheck="false" autocorrect="off" autocapitalize="off" autocomplete="off" wrap="off" aria-label="JavaScript 代码编辑器"></textarea></div><div class="editor-accessory" aria-label="编辑快捷工具"><button data-insert="  " aria-label="插入两个空格">⇥ Tab</button><button data-pair="()">( )</button><button data-pair="{}">{ }</button><button data-pair="[]">[ ]</button><button data-pair="&quot;&quot;">&quot; &quot;</button><button data-insert=";">;</button><button data-insert="=">=</button><button data-insert="// ">//</button><button data-insert="await ">await</button><button data-insert="console.log()">log</button></div><section id="output-panel" class="output-panel"><div class="output-header"><button id="output-toggle" class="output-toggle">' + icon('down') + '运行结果</button><span id="output-indicator" class="output-indicator"></span><span id="output-state" class="output-state"></span><div class="output-actions"><button id="output-clear">清空</button></div></div><div id="output-tabs" class="output-tabs"></div><div id="output-content" class="output-content"></div></section></section>';
    const input = document.getElementById('code-input');
    input.value = script.code;
    const editorArea = main.querySelector('.editor-area');
    const viewport = document.createElement('div'); viewport.className = 'code-viewport';
    const highlight = document.createElement('pre'); highlight.className = 'code-highlight'; highlight.setAttribute('aria-hidden', 'true');
    const highlightContent = document.createElement('code'); highlightContent.id = 'code-highlight-content'; highlight.appendChild(highlightContent);
    editorArea.appendChild(viewport); viewport.append(highlight, input);
    input.setAttribute('enterkeyhint', 'enter'); input.setAttribute('inputmode', 'text');
    input.oninput = () => { updateLineNumbers(); updateCursor(); queueSave(); updateCompletion(); };
    input.addEventListener('compositionstart', () => { viewport.classList.add('is-composing'); hideCompletion(); });
    input.addEventListener('compositionend', () => { viewport.classList.remove('is-composing'); updateLineNumbers(); updateCursor(); queueSave(); });
    input.onscroll = syncEditorScroll;
    input.onblur = hideCompletion;
    input.onclick = () => { updateCursor(); updateCompletion(); };
    input.onkeyup = updateCursor;
    input.onselect = updateCursor;
    input.onkeydown = event => {
      if (completionKey(event)) return;
      if (event.key === 'Tab') { event.preventDefault(); insertText('  '); }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); runCurrent(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); flushSave(); notify('已保存'); }
    };
    document.getElementById('editor-back').onclick = () => navigate('scripts');
    document.getElementById('editor-run').onclick = () => {
      if (window.ScriptRunner && ScriptRunner.isRunning()) { ScriptRunner.stop(); } else runCurrent();
    };
    document.getElementById('editor-more').onclick = () => scriptMenu(state.currentId);
    document.getElementById('output-toggle').onclick = () => { state.outputOpen = !state.outputOpen; renderOutput(); };
    document.getElementById('output-clear').onclick = () => { state.logs = []; renderOutput(); };
    main.querySelectorAll('[data-insert]').forEach(button => { button.onpointerdown = event => event.preventDefault(); button.onclick = () => insertText(button.dataset.insert); });
    main.querySelectorAll('[data-pair]').forEach(button => { button.onpointerdown = event => event.preventDefault(); button.onclick = () => insertPair(button.dataset.pair); });
    updateLineNumbers();
    updateRunButton();
    renderOutput();
    updateViewport();
  }
  const syntaxKeywords = new Set('as async await break case catch class const continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof undefined var void while with yield'.split(' '));
  const syntaxAPIs = new Set('Alert args Calendar CalendarEvent CallbackURL Color config console Contact ContactsContainer ContactsGroup Data Date DateFormatter DatePicker Device Dictation DocumentPicker DrawContext FileManager Font Image importModule JSON Keychain LinearGradient ListWidget Location Mail Math Message module Notification Number Pasteboard Path Photos Point Promise QuickLook Rect RecurrenceRule RelativeDateTimeFormatter Reminder Request Safari Script Set SFSymbol ShareSheet Size Speech String TextField Timer UITable UITableCell UITableRow URL URLScheme UUID WebView XMLParser'.split(' '));
  let completionEnabled = true;
  try { completionEnabled = localStorage.getItem('scriptable-editor-completion-v2') !== 'off'; } catch (_) {}
  const completion = { items: [], selected: -1, start: 0, end: 0, prefix: '' };
  function hideCompletion() { completion.items = []; completion.selected = -1; document.querySelector('.completion-popup')?.remove(); document.getElementById('code-input')?.removeAttribute('aria-activedescendant'); }
  function updateCompletion() {
    const input = document.getElementById('code-input');
    if (!completionEnabled || !input || input.selectionStart !== input.selectionEnd || input.closest('.is-composing')) return hideCompletion();
    const before = input.value.slice(0, input.selectionStart); if (before.length > 400000) return hideCompletion();
    const code = before.replace(/\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|"(?:\\.|[^"\\\n])*(?:"|(?=\n|$))|'(?:\\.|[^'\\\n])*(?:'|(?=\n|$))|`(?:\\.|[^`\\])*(?:`|$)/g, value => '\0'.repeat(value.length));
    const token = /(?:([A-Za-z_$][\w$]*)\.)?([A-Za-z_$][\w$]*)$/.exec(code); if (!token) return hideCompletion();
    const owner = token[1], prefix = token[2]; let candidates = [];
    if (owner) {
      let type = owner, instance = false; const variables = {};
      for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:new\s+)?([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g)) {
        const derived = { addText: 'WidgetText', addDate: 'WidgetDate', addImage: 'WidgetImage', addStack: 'WidgetStack', addTextField: 'TextField', addSecureTextField: 'TextField', addRow: 'UITableRow' }[m[3]];
        variables[m[1]] = derived || variables[m[2]] || m[2];
      }
      if (variables[owner]) { type = variables[owner]; instance = true; }
      const doc = state.docs.find(item => item.name === type);
      candidates = (doc?.members || []).filter(member => !member.startsWith('-new ') && (instance ? !member.startsWith('+') : !member.startsWith('-'))).map(member => ({ name: member.replace(/^[+-]/, ''), detail: member.startsWith('+') || member.startsWith('-') ? '方法 · ' + type : '属性 · ' + type }));
    } else if (prefix.length >= 2) candidates = [...new Set([...state.docs.map(doc => doc.name), ...syntaxAPIs])].map(name => ({ name, detail: state.docs.find(doc => doc.name === name)?.description || 'JavaScript 全局' }));
    const matches = candidates.filter(item => item.name.toLowerCase().startsWith(prefix.toLowerCase()) && item.name !== prefix).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 4);
    hideCompletion(); if (!matches.length) return;
    Object.assign(completion, { items: matches, selected: -1, start: input.selectionStart - prefix.length, end: input.selectionStart, prefix });
    const popup = document.createElement('div'); popup.className = 'completion-popup'; popup.id = 'editor-completion'; popup.setAttribute('role', 'listbox'); popup.setAttribute('aria-label', '代码补全建议');
    matches.forEach((item, index) => { const button = document.createElement('button'); button.id = 'completion-option-' + index; button.type = 'button'; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', 'false'); const name = document.createElement('strong'), detail = document.createElement('small'); name.textContent = item.name; detail.textContent = item.detail; button.append(name, detail); button.onpointerdown = event => event.preventDefault(); button.onclick = () => acceptCompletion(index); popup.appendChild(button); });
    input.parentElement.appendChild(popup);
  }
  function acceptCompletion(index) {
    const input = document.getElementById('code-input'), item = completion.items[index];
    if (!input || !item || input.selectionStart !== completion.end || input.selectionEnd !== completion.end || input.value.slice(completion.start, completion.end) !== completion.prefix) return hideCompletion();
    input.setRangeText(item.name, completion.start, completion.end, 'end'); hideCompletion(); input.focus({ preventScroll: true }); updateLineNumbers(); updateCursor(); queueSave();
  }
  function completionKey(event) {
    if (event.isComposing || !completion.items.length) return false;
    if (event.key === 'Escape') { event.preventDefault(); hideCompletion(); return true; }
    if (event.key === 'Enter' && completion.selected >= 0) { event.preventDefault(); acceptCompletion(completion.selected); return true; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return false;
    event.preventDefault(); const length = completion.items.length; completion.selected = completion.selected < 0 ? event.key === 'ArrowDown' ? 0 : length - 1 : (completion.selected + (event.key === 'ArrowDown' ? 1 : -1) + length) % length;
    document.querySelectorAll('.completion-popup button').forEach((button, index) => { const selected = index === completion.selected; button.classList.toggle('selected', selected); button.setAttribute('aria-selected', String(selected)); });
    document.getElementById('code-input')?.setAttribute('aria-activedescendant', 'completion-option-' + completion.selected); return true;
  }
  function highlightCode(value) {
    if (value.length > 400000) return escape(value) + '\n';
    const tokens = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|"(?:\\.|[^"\\\n])*(?:"|(?=\n|$))|'(?:\\.|[^'\\\n])*(?:'|(?=\n|$))|`(?:\\.|[^`\\])*(?:`|$)|\b(?:0[xX][\da-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b[A-Za-z_$][\w$]*\b|[{}\[\]();.,]|(?:=>|===?|!==?|\?\?|&&|\|\||[+\-*%<>!=?:])/g;
    let output = '', cursor = 0, match;
    while ((match = tokens.exec(value))) {
      output += escape(value.slice(cursor, match.index)); const token = match[0]; let type = '';
      if (token.startsWith('//') || token.startsWith('/*')) type = 'comment';
      else if (/^["'`]/.test(token)) type = 'string';
      else if (/^\d/.test(token)) type = 'number';
      else if (syntaxKeywords.has(token)) type = 'keyword';
      else if (syntaxAPIs.has(token) || state.docs.some(doc => doc.name === token)) type = 'api';
      else if (/^[A-Za-z_$]/.test(token) && /^\s*\(/.test(value.slice(tokens.lastIndex))) type = 'function';
      else if (!/^[A-Za-z_$]/.test(token)) type = 'punctuation';
      output += type ? '<span class="syntax-' + type + '">' + escape(token) + '</span>' : escape(token); cursor = tokens.lastIndex;
    }
    return output + escape(value.slice(cursor)) + '\n';
  }
  function updateLineNumbers() {
    const input = document.getElementById('code-input');
    const gutter = document.getElementById('line-number-content');
    if (!input || !gutter) return;
    gutter.textContent = Array.from({ length: input.value.split('\n').length }, (_, index) => index + 1).join('\n');
    const highlight = document.getElementById('code-highlight-content');
    if (highlight) highlight.innerHTML = highlightCode(input.value);
    syncEditorScroll();
  }
  function syncEditorScroll() {
    const input = document.getElementById('code-input');
    const gutter = document.getElementById('line-number-content');
    if (input && gutter) gutter.style.transform = 'translateY(-' + input.scrollTop + 'px)';
    const highlight = document.getElementById('code-highlight-content');
    if (input && highlight) highlight.style.transform = 'translate(-' + input.scrollLeft + 'px,-' + input.scrollTop + 'px)';
  }
  let viewportBaseline = innerHeight, viewportWidth = innerWidth;
  function updateViewport() {
    const view = window.visualViewport, height = view && view.scale === 1 ? view.height : innerHeight;
    if (Math.abs(innerWidth - viewportWidth) > 40) { viewportWidth = innerWidth; viewportBaseline = innerHeight; }
    document.documentElement.style.setProperty('--app-height', Math.round(height) + 'px');
    const editing = document.activeElement?.id === 'code-input';
    if (!editing) viewportBaseline = Math.max(viewportBaseline, innerHeight);
    document.body.classList.toggle('keyboard-open', editing && height < viewportBaseline - 120);
  }
  window.addEventListener('resize', updateViewport);
  window.visualViewport?.addEventListener('resize', updateViewport);
  window.visualViewport?.addEventListener('scroll', updateViewport);
  document.addEventListener('focusin', updateViewport);
  document.addEventListener('focusout', () => requestAnimationFrame(updateViewport));
  updateViewport();
  function updateCursor() {
    const input = document.getElementById('code-input');
    const display = document.getElementById('cursor-position');
    if (!input || !display) return;
    const before = input.value.slice(0, input.selectionStart).split('\n');
    display.textContent = 'Ln ' + before.length + ', Col ' + (before[before.length - 1].length + 1);
  }
  function insertText(text, pair) {
    const input = document.getElementById('code-input');
    if (!input) return;
    hideCompletion();
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.setRangeText(text, start, end, 'end');
    if (pair) input.selectionStart = input.selectionEnd = start + 1;
    input.focus({ preventScroll: true });
    updateLineNumbers(); updateCursor(); queueSave();
  }
  function insertPair(pair) {
    const input = document.getElementById('code-input');
    if (!input) return;
    const selected = input.value.slice(input.selectionStart, input.selectionEnd);
    insertText(pair[0] + selected + pair[1], !selected);
  }
  function queueSave() {
    const status = document.getElementById('save-status');
    if (status) status.textContent = '正在保存…';
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(flushSave, 400);
  }
  function flushSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    const input = document.getElementById('code-input');
    const script = getScript(state.currentId);
    if (!input || !script) return true;
    if (script.code === input.value) return true;
    const updated = Object.assign({}, script, { code: input.value, updatedAt: Date.now() });
    const success = saveScript(updated);
    const status = document.getElementById('save-status');
    if (success && status) status.innerHTML = '<span class="save-dot"></span>已自动保存';
    return success;
  }
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
  function updateRunButton() {
    const button = document.getElementById('editor-run');
    if (!button) return;
    const running = Boolean(window.ScriptRunner && ScriptRunner.isRunning());
    button.classList.toggle('running', running);
    button.innerHTML = icon(running ? 'stop' : 'play') + '<span>' + (running ? '停止' : '运行') + '</span>';
    button.setAttribute('aria-label', running ? '停止运行脚本' : '运行脚本');
  }
  async function runCurrent() {
    if (!window.ScriptRunner) return notify('脚本运行器未就绪');
    if (ScriptRunner.isRunning()) return notify('已有脚本正在运行，请先停止');
    if (!flushSave()) return;
    const script = getScript(state.currentId);
    if (!script) return;
    state.runId = script.id;
    state.logs = [];
    state.widget = null;
    state.preview = null;
    state.outputOpen = true;
    state.outputTab = 'console';
    state.runState = 'running';
    renderOutput();
    try {
      const promise = ScriptRunner.run(script, {
        onLog(level, values) { state.logs.push({ level, text: (Array.isArray(values) ? values : [values]).map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' '), time: new Date() }); if (state.logs.length > 500) state.logs.shift(); renderOutput(); },
        onWidget(tree, options = {}) { state.widget = tree; state.widgetFamily = options.family || 'medium'; state.outputTab = 'widget'; renderOutput(); },
        onPreview(value, format, options = {}) { state.preview = { value, format }; state.outputTab = 'preview'; renderOutput(); if (options.fullscreen) showFullscreenPreview(); },
        onState(status, message) {
          state.runState = status;
          if (status === 'error' && message && !state.logs.some(log => log.text === message)) state.logs.push({ level: 'error', text: String(message), time: new Date() });
          updateRunButton(); renderOutput();
        }
      });
      updateRunButton();
      await promise;
      if (state.runState === 'running') state.runState = 'done';
      try{
        const latest=hostSync('repo.list',{}).map(cleanScript),current=latest.find(item=>item.id===state.currentId),input=document.getElementById('code-input');
        state.scripts=latest;
        if(!current){notify('脚本库已由脚本更新');navigate('scripts');}
        else if(input&&input.value===script.code&&input.value!==current.code){input.value=current.code;input.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('editor-name').textContent=current.name;}
      }catch(error){notify('脚本库更新失败：'+error.message);}
    } catch (error) {
      state.runState = 'error';
      const message = error.message || String(error);
      if (!state.logs.some(log => log.text === message)) state.logs.push({ level: 'error', text: message, time: new Date() });
    }
    updateRunButton(); renderOutput();
  }
  function renderOutput() {
    const panel = document.getElementById('output-panel');
    if (!panel) return;
    panel.classList.toggle('output-closed', !state.outputOpen);
    const statuses = { idle: '等待运行', running: '运行中', done: '已完成', error: '运行失败', stopped: '已停止' };
    document.getElementById('output-state').textContent = statuses[state.runState] || state.runState;
    document.getElementById('output-indicator').className = 'output-indicator ' + (state.runState === 'running' ? 'running' : state.runState === 'error' ? 'error' : '');
    const tabs = [['console', '控制台' + (state.logs.length ? ' · ' + state.logs.length : '')]];
    if (state.widget) tabs.push(['widget', '小组件']);
    if (state.preview) tabs.push(['preview', '预览']);
    if (!tabs.some(tab => tab[0] === state.outputTab)) state.outputTab = 'console';
    const tabBar = document.getElementById('output-tabs');
    tabBar.innerHTML = tabs.map(([id, label]) => '<button class="' + (id === state.outputTab ? 'active' : '') + '" data-output-tab="' + id + '">' + label + '</button>').join('');
    tabBar.querySelectorAll('[data-output-tab]').forEach(button => button.onclick = () => { state.outputTab = button.dataset.outputTab; renderOutput(); });
    const content = document.getElementById('output-content');
    content.replaceChildren();
    if (state.outputTab === 'widget') return renderWidget(content);
    if (state.outputTab === 'preview') return renderPreview(content);
    if (!state.logs.length) { const empty = document.createElement('p'); empty.className = 'console-empty'; empty.textContent = state.runState === 'running' ? '脚本正在运行…' : state.runState === 'done' ? '运行完成。使用 console.log() 输出信息。' : '运行脚本后，在这里查看输出。\nconsole.log("Hello, Android!");'; content.appendChild(empty); }
    state.logs.forEach(log => {
      const row = document.createElement('div'); row.className = 'log-row log-' + (['error', 'warn', 'info'].includes(log.level) ? log.level : 'info');
      const time = document.createElement('span'); time.className = 'log-time'; time.textContent = log.time.toLocaleTimeString('zh-CN', { hour12: false });
      const body = document.createElement('span'); body.className = 'log-body'; body.textContent = log.text;
      row.append(time, body); content.appendChild(row);
    });
    content.scrollTop = content.scrollHeight;
  }
  function treeElement(node, depth) {
    if (!node || typeof node !== 'object' || depth > 20) return document.createElement('span');
    let element;
    if (node.type === 'text' || node.type === 'date') { element = document.createElement('div'); element.className = 'widget-text'; element.textContent = node.type === 'date' ? widgetDateText(node) : String(node.text || ''); }
    else if (node.type === 'spacer') { element = document.createElement('div'); element.className = 'widget-spacer'; if (Number.isFinite(node.length)) element.style.height = Math.min(300, Math.max(0, node.length)) + 'px'; else element.style.flex = '1'; }
    else if (node.type === 'image') { element = document.createElement('img'); element.className = 'widget-image'; const src = node.src || node.data || node.image; if (validImageURL(src)) element.src = src; element.alt = node.description || '小组件图片'; element.style.objectFit = node.contentMode === 'fill' ? 'cover' : 'contain'; if (node.tintColor || node.imageTintColor) { const tint = node.tintColor || node.imageTintColor; if (/^#[a-f0-9]{3,8}$/i.test(tint) && validImageURL(src)) { const tinted = document.createElement('span'); tinted.className = 'widget-image widget-tinted-image'; tinted.style.backgroundColor = tint; tinted.style.webkitMaskImage = 'url(' + JSON.stringify(src) + ')'; tinted.style.maskImage = 'url(' + JSON.stringify(src) + ')'; element.style.opacity = '0'; tinted.appendChild(element); element = tinted; } } }
    else { element = document.createElement('div'); element.className = 'widget-stack'; if (node.layout === 'horizontal') { element.style.flexDirection = 'row'; element.style.alignItems = 'center'; } (Array.isArray(node.children) ? node.children.slice(0, 150) : []).forEach(child => element.appendChild(treeElement(child, depth + 1))); }
    const cssColor = value => typeof value === 'string' && /^(#[a-f0-9]{3,8}|rgba?\([\d.,\s]+\)|[a-z]+)$/i.test(value);
    if (cssColor(node.color)) element.style.color = node.color;
    if (cssColor(node.backgroundColor)) element.style.backgroundColor = node.backgroundColor;
    const gradient = widgetGradient(node.backgroundGradient), background = node.backgroundImage;
    if (gradient) element.style.backgroundImage = gradient;
    if (validImageURL(background)) { element.style.backgroundImage = 'url(' + JSON.stringify(background) + ')' + (gradient ? ',' + gradient : ''); element.style.backgroundSize = 'cover'; element.style.backgroundPosition = 'center'; }
    if (node.font && typeof node.font === 'object') { if (Number.isFinite(node.font.size)) element.style.fontSize = Math.min(80, Math.max(6, node.font.size)) + 'px'; if (node.font.weight) element.style.fontWeight = String(node.font.weight); if (node.font.family === 'monospace' || /mono/i.test(node.font.family || '')) element.style.fontFamily = 'var(--mono)'; }
    if (Number.isFinite(node.spacing)) element.style.gap = Math.min(100, Math.max(0, node.spacing)) + 'px';
    if (Array.isArray(node.padding) && node.padding.length === 4) { const values = node.padding.map(value => Math.min(100, Math.max(0, Number(value) || 0))); element.style.padding = [values[0], values[3], values[2], values[1]].map(value => value + 'px').join(' '); }
    const alignment = node.textAlign || node.alignment;
    if (alignment === 'center' || alignment === 'right') element.style.textAlign = alignment;
    if (Number.isFinite(node.cornerRadius)) element.style.borderRadius = Math.min(50, Math.max(0, node.cornerRadius)) + 'px';
    const size = node.type === 'image' ? node.imageSize || node.size : node.size;
    if (size && Number.isFinite(size.width) && size.width > 0) element.style.width = Math.min(700, size.width) + 'px';
    if (size && Number.isFinite(size.height) && size.height > 0) element.style.height = Math.min(700, size.height) + 'px';
    const opacity = node.type === 'image' ? node.imageOpacity : node.textOpacity;
    if (Number.isFinite(opacity)) element.style.opacity = String(Math.max(0, Math.min(1, opacity)));
    if (Number.isFinite(node.lineLimit) && node.lineLimit > 0) { element.style.display = '-webkit-box'; element.style.webkitBoxOrient = 'vertical'; element.style.webkitLineClamp = String(Math.floor(node.lineLimit)); element.style.overflow = 'hidden'; }
    if (Number.isFinite(node.borderWidth) && node.borderWidth > 0) { element.style.borderWidth = Math.min(20, node.borderWidth) + 'px'; element.style.borderStyle = 'solid'; if (cssColor(node.borderColor)) element.style.borderColor = node.borderColor; }
    if (node.type !== 'text' && node.type !== 'date' && node.type !== 'image' && ['top', 'center', 'bottom'].includes(node.alignment)) element.style.alignItems = node.alignment === 'top' ? 'flex-start' : node.alignment === 'bottom' ? 'flex-end' : 'center';
    if (node.type !== 'text' && node.type !== 'date' && Number.isFinite(node.cornerRadius)) element.style.overflow = 'hidden';
    if (typeof node.url === 'string' && node.url) { element.classList.add('widget-link'); element.setAttribute('role', 'link'); element.tabIndex = 0; element.onclick = () => hostCall('safari.open', { url: node.url }).catch(error => notify(error.message)); element.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); element.click(); } }; }
    return element;
  }
  function validImageURL(value) { return typeof value === 'string' && /^(data:image\/(?:png|jpeg|gif|webp);base64,|https?:\/\/)/i.test(value); }
  function widgetGradient(gradient) {
    if (!gradient || !Array.isArray(gradient.colors) || !gradient.colors.length || gradient.colors.some(c => typeof c !== 'string' || !/^#[a-f0-9]{3,8}$/i.test(c))) return '';
    const start = gradient.startPoint || { x: 0, y: 0 }, end = gradient.endPoint || { x: 0, y: 1 }, angle = Math.atan2(Number(end.x) - Number(start.x), Number(start.y) - Number(end.y)) * 180 / Math.PI;
    const stops = gradient.colors.map((c, i) => c + ' ' + (Math.max(0, Math.min(1, Number(gradient.locations?.[i] ?? i / Math.max(1, gradient.colors.length - 1)))) * 100) + '%');
    return 'linear-gradient(' + (Number.isFinite(angle) ? angle : 180) + 'deg,' + stops.join(',') + ')';
  }
  function widgetDateText(node) {
    const date = new Date(node.date); if (!Number.isFinite(date.getTime())) return String(node.text || '');
    if (node.dateStyle === 'time') return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (node.dateStyle === 'relative') { const seconds = (date.getTime() - Date.now()) / 1000; const [unit, divisor] = Math.abs(seconds) >= 86400 ? ['day', 86400] : Math.abs(seconds) >= 3600 ? ['hour', 3600] : Math.abs(seconds) >= 60 ? ['minute', 60] : ['second', 1]; return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(seconds / divisor), unit); }
    if (node.dateStyle === 'timer' || node.dateStyle === 'offset') { const difference = Math.floor((Date.now() - date.getTime()) / 1000), seconds = Math.abs(difference), clock = Math.floor(seconds / 3600) + ':' + String(Math.floor(seconds % 3600 / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0'); return (node.dateStyle === 'offset' ? difference < 0 ? '-' : '+' : '') + clock; }
    return date.toLocaleDateString();
  }
  function renderWidget(content) {
    const wrap = document.createElement('div'); wrap.className = 'widget-preview-wrap';
    const preview = treeElement(state.widget, 0); preview.classList.add('widget-preview'); preview.dataset.family = state.widgetFamily || 'medium'; wrap.appendChild(preview);
    const note = document.createElement('p'); note.className = 'widget-footnote'; note.textContent = '添加后可配置组件脚本、参数与刷新频率。'; wrap.appendChild(note);
    const button = document.createElement('button'); button.className = 'widget-pin'; button.innerHTML = icon('widget') + '添加到主屏幕'; button.onclick = async () => {
      if (!native()) return notify('请在 Android 应用中添加桌面小组件');
      button.disabled = true;
      try { await hostCall('widget.pin', { scriptId: state.runId, tree: state.widget, family: state.widgetFamily || 'medium' }); notify('已请求添加小组件，请在系统提示中确认'); } catch (error) { notify('无法添加：' + error.message); }
      button.disabled = false;
    };
    wrap.appendChild(button); content.appendChild(wrap);
  }
  function renderPreview(content) {
    const preview = state.preview;
    if (!preview) return;
    const value = preview.value;
    if (preview.format === 'html') { const iframe = document.createElement('iframe'); iframe.className = 'preview-frame'; iframe.setAttribute('sandbox', ''); iframe.setAttribute('title', 'HTML 预览'); iframe.srcdoc = String(value); content.appendChild(iframe); }
    else if (preview.format === 'image' && typeof value === 'string' && /^(data:image\/(?:png|jpeg|gif|webp);base64,|https?:\/\/)/i.test(value)) { const img = document.createElement('img'); img.className = 'preview-image'; img.src = value; img.alt = '脚本图片预览'; content.appendChild(img); }
    else { const pre = document.createElement('pre'); pre.className = 'preview-text'; pre.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); content.appendChild(pre); }
  }
  function showFullscreenPreview() {
    showModal('预览', '<div id="fullscreen-preview-content" class="fullscreen-preview-content"></div>');
    modalRoot.querySelector('.modal')?.classList.add('fullscreen-modal');
    const content = document.getElementById('fullscreen-preview-content'); if (content) renderPreview(content);
  }
  let modalPreviousFocus = null;
  function showModal(title, body, footer) {
    modalPreviousFocus = document.activeElement;
    modalRoot.innerHTML = '<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-heading"><h2 id="modal-title">' + escape(title) + '</h2><button class="modal-close" id="modal-close" aria-label="关闭">' + icon('close') + '</button></div>' + body + (footer ? '<div class="modal-footer">' + footer + '</div>' : '') + '</section></div>';
    document.getElementById('modal-close').onclick = closeModal;
    modalRoot.querySelector('.modal-backdrop').onclick = event => { if (event.target === event.currentTarget) closeModal(); };
    const input = modalRoot.querySelector('input');
    setTimeout(() => { const target = input || document.getElementById('modal-close'); if (target) target.focus({ preventScroll: true }); }, 50);
  }
  function closeModal() {
    if (!modalRoot.firstChild) return;
    modalRoot.replaceChildren();
    if (modalPreviousFocus && modalPreviousFocus.isConnected) modalPreviousFocus.focus({ preventScroll: true });
  }
  document.addEventListener('keydown', event => {
    if (!modalRoot.firstChild) return;
    if (event.key === 'Escape') closeModal();
    if (event.key === 'Tab') {
      const items = Array.from(modalRoot.querySelectorAll('button,input,select,a[href]')).filter(el => !el.disabled);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  function scriptProperties(id) {
    flushSave();
    const existing = id ? getScript(id) : null;
    let selectedColor = existing ? existing.color : colors[0];
    let selectedIcon = existing ? existing.icon : 'code';
    showModal(existing ? '脚本设置' : '新建脚本', '<label class="modal-label" for="script-name">脚本名称</label><input class="modal-input" id="script-name" maxlength="100" placeholder="给你的想法起个名字" value="' + escape(existing ? existing.name : '') + '"><span class="modal-label">颜色</span><div class="color-grid">' + colors.map(color => '<button class="color-swatch' + (selectedColor === color ? ' selected' : '') + '" data-color="' + color + '" style="background:' + color + ';--swatch:' + color + '" aria-label="颜色 ' + color + '"></button>').join('') + '</div><span class="modal-label">图标</span><div class="icon-grid">' + scriptIcons.map(symbol => '<button class="icon-choice' + (selectedIcon === symbol ? ' selected' : '') + '" data-icon="' + symbol + '" aria-label="图标 ' + symbol + '">' + icon(symbol) + '</button>').join('') + '</div>', '<button id="properties-cancel" class="secondary-button">取消</button><button id="properties-save" class="primary-button">' + (existing ? '保存' : '创建脚本') + '</button>');
    modalRoot.querySelectorAll('[data-color]').forEach(button => button.onclick = () => { selectedColor = button.dataset.color; modalRoot.querySelectorAll('[data-color]').forEach(el => el.classList.toggle('selected', el === button)); });
    modalRoot.querySelectorAll('[data-icon]').forEach(button => button.onclick = () => { selectedIcon = button.dataset.icon; modalRoot.querySelectorAll('[data-icon]').forEach(el => el.classList.toggle('selected', el === button)); });
    document.getElementById('properties-cancel').onclick = closeModal;
    const commit = () => {
      const name = document.getElementById('script-name').value.trim();
      if (!name) { document.getElementById('script-name').focus(); return notify('请输入脚本名称'); }
      const script = existing ? Object.assign({}, existing, { name, color: selectedColor, icon: selectedIcon, updatedAt: Date.now() }) : { id: uniqueId(), name, color: selectedColor, icon: selectedIcon, updatedAt: Date.now(), code: '// ' + name.replace(/[\r\n]/g, ' ') + '\n// 写下你的第一个脚本，然后点击运行。\n\nconsole.log("你好，Android！");\n' };
      if (saveScript(script)) { closeModal(); if (!existing) openScript(script.id); else if (state.currentId) { document.getElementById('editor-name').textContent = script.name; } else renderScripts(); }
    };
    document.getElementById('properties-save').onclick = commit;
    document.getElementById('script-name').onkeydown = event => { if (event.key === 'Enter') commit(); };
  }
  function scriptMenu(id) {
    flushSave();
    const script = getScript(id);
    if (!script) return;
    showModal(script.name, '<div class="action-list"><button id="action-edit">' + icon('edit') + '名称、颜色与图标</button><button id="action-copy">' + icon('copy') + '复制脚本</button><button id="action-export">' + icon('upload') + '导出 .js 文件</button><button id="action-delete" class="danger">' + icon('trash') + '删除脚本</button></div>');
    document.getElementById('action-edit').onclick = () => scriptProperties(id);
    document.getElementById('action-copy').onclick = () => {
      const copy = Object.assign({}, script, { id: uniqueId(), name: uniqueName(script.name + ' 副本'), updatedAt: Date.now() });
      if (saveScript(copy)) { closeModal(); notify('已复制脚本'); openScript(copy.id); }
    };
    document.getElementById('action-export').onclick = () => { closeModal(); exportScript(id); };
    document.getElementById('action-delete').onclick = () => confirmDelete(id);
  }
  function confirmDelete(id) {
    const script = getScript(id);
    if (!script) return;
    showModal('删除脚本？', '<p class="modal-copy">「' + escape(script.name) + '」将从此设备删除。你可以先导出文件进行备份。</p>', '<button id="delete-cancel" class="secondary-button">保留</button><button id="delete-confirm" class="danger-button">删除</button>');
    document.getElementById('delete-cancel').onclick = closeModal;
    document.getElementById('delete-confirm').onclick = () => {
      try {
        if (state.runId === id && window.ScriptRunner && ScriptRunner.isRunning()) ScriptRunner.stop();
        hostSync('repo.delete', { id });
        state.scripts = state.scripts.filter(item => item.id !== id);
        closeModal();
        if (state.currentId === id) navigate('scripts'); else render();
        notify('脚本已删除');
      } catch (error) { notify('删除失败：' + error.message); }
    };
  }
  async function importScript() {
    try {
      const imported = await hostCall('repo.import', {});
      if (!imported) return;
      const script = cleanScript(Object.assign({}, imported, { id: uniqueId(), name: uniqueName(imported.name || '导入的脚本'), updatedAt: Date.now() }));
      if (saveScript(script)) { notify('导入成功，点击运行可执行脚本'); openScript(script.id); }
    } catch (error) {
      if (native()) return notify('导入失败：' + error.message);
      browserImport();
    }
  }
  function browserImport() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.js,.mjs,.txt,text/javascript,application/javascript,text/plain';
    input.onchange = async () => {
      const file = input.files[0]; if (!file) return;
      if (file.size > 2 * 1024 * 1024) return notify('请选择小于 2 MB 的脚本文件');
      try {
        const code = await file.text();
        const script = cleanScript({ id: uniqueId(), name: uniqueName(file.name.replace(/\.(?:m?js|txt)$/i, '')), code, color: colors[0], icon: 'code', updatedAt: Date.now() });
        if (saveScript(script)) { notify('导入成功'); openScript(script.id); }
      } catch (error) { notify('导入失败：' + error.message); }
    };
    input.click();
  }
  async function exportScript(id) {
    flushSave();
    const script = getScript(id); if (!script) return;
    try { const result = await hostCall('repo.export', { id }); if (result !== false) notify('脚本已导出'); }
    catch (error) {
      if (native()) return notify('导出失败：' + error.message);
      const url = URL.createObjectURL(new Blob([script.code], { type: 'application/javascript;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = script.name.replace(/[\\/:*?"<>|]/g, '_') + '.js'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); notify('已下载 JavaScript 文件');
    }
  }
  window.__openScript = (id, run, options={}) => {
    try{state.scripts=hostSync('repo.list',{}).map(cleanScript);}catch(error){notify(error.message);return false;}
    if(run&&window.ScriptRunner?.isRunning())ScriptRunner.stop();
    const opened=openScript(String(id),Boolean(run));if(opened&&options.settings)scriptMenu(String(id));return opened;
  };
  window.__goBack = () => {
    if (modalRoot.firstChild) { closeModal(); return true; }
    if (state.currentId) { navigate('scripts'); return true; }
    if (state.tab !== 'scripts') { navigate('scripts'); return true; }
    return false;
  };
  async function init() {
    main.innerHTML = '<div class="loading">正在打开你的工作空间…</div>';
    try {
      if (window.Host && Host.ready) await Host.ready;
      const bootstrap = hostSync('bootstrap', {});
      state.scripts = (bootstrap.scripts || []).map(cleanScript);
      state.settings = Object.assign(state.settings, bootstrap.settings || {});
      if (!['auto', 'light', 'dark'].includes(state.settings.theme)) state.settings.theme = 'auto';
      state.settings.fontSize = Math.min(24, Math.max(10, Number(state.settings.fontSize) || 13));
      state.device = bootstrap.device || {};
      const results = await Promise.allSettled([fetch('examples.json').then(res => { if (!res.ok) throw new Error('示例加载失败'); return res.json(); }), fetch('docs.json').then(res => { if (!res.ok) throw new Error('文档加载失败'); return res.json(); })]);
      if (results[0].status === 'fulfilled' && Array.isArray(results[0].value)) state.examples = results[0].value;
      if (results[1].status === 'fulfilled' && Array.isArray(results[1].value)) state.docs = results[1].value;
      applySettings(); navRender(); render();
      window.__appReady = true;
      if (bootstrap.openScriptId) openScript(bootstrap.openScriptId, Boolean(bootstrap.runScript));
      hostCall('ui.ready', {}).catch(() => {});
    } catch (error) { main.innerHTML = '<div class="error-box">工作空间无法打开：' + escape(error.message) + '<br>请关闭后重新打开应用。</div>'; }
  }
  init();
})();


