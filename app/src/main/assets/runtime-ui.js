/* Scriptable presentation APIs. The Android host uses isolated WebViews without a native bridge. */
(() => {
  'use strict';
  const R = self.__runtime;
  if (!R) throw new Error('Presentation APIs require the Scriptable runtime.');
  const { host, persist, observe } = R;
  const text = (value, label) => { if (typeof value !== 'string') throw new TypeError(`${label} must be a string.`); return value; };
  const serial = value => JSON.parse(JSON.stringify(value));
  const uuid = () => self.UUID.string();
  const tables = new Map(), webViews = new Map();
  const track = (prototype, names) => { for (const name of names) { const implementation = prototype[name]; prototype[name] = function (...args) { return observe(implementation.apply(this, args)); }; } };

  class WebView {
    constructor() { this._id = uuid(); this.shouldAllowRequest = null; webViews.set(this._id, this); }
    async loadURL(url) { return host('webview.load', { webviewId: this._id, mode: 'url', url: text(url, 'URL'), interceptNavigation: typeof this.shouldAllowRequest === 'function' }); }
    async loadHTML(html, baseURL) { return host('webview.load', { webviewId: this._id, mode: 'html', html: text(html, 'HTML'), baseURL: baseURL == null ? null : text(baseURL, 'Base URL'), interceptNavigation: typeof this.shouldAllowRequest === 'function' }); }
    async loadFile(fileURL) { return host('webview.load', { webviewId: this._id, mode: 'file', path: text(fileURL, 'File URL'), interceptNavigation: typeof this.shouldAllowRequest === 'function' }); }
    async loadRequest(request) {
      if (!(request instanceof self.Request)) throw new TypeError('Expected a Request.');
      // Use the common HTTP implementation so every method/header/body/multipart option is respected.
      const data = await request.load();
      const mime = request.response?.mimeType || 'text/html';
      if (/^image\//i.test(mime)) return this.loadHTML(`<html><meta name="viewport" content="width=device-width"><body style="margin:0"><img style="max-width:100%" src="data:${mime.replace(/[^a-z0-9/+.-]/gi, '')};base64,${data.toBase64String()}"></body></html>`, request.response?.url || request.url);
      return this.loadHTML(data.toRawString(), request.response?.url || request.url);
    }
    async evaluateJavaScript(javaScript, useCallback = false) { return host('webview.evaluate', { webviewId: this._id, javaScript: text(javaScript, 'JavaScript'), useCallback: !!useCallback }); }
    async getHTML() { return this.evaluateJavaScript('document.documentElement.outerHTML'); }
    async present(fullscreen = false) { return host('webview.present', { webviewId: this._id, fullscreen: !!fullscreen }); }
    async waitForLoad() { return host('webview.wait', { webviewId: this._id }); }
    async close() { webViews.delete(this._id); return host('webview.close', { webviewId: this._id }); }
    static async loadURL(url, preferredSize, fullscreen = false) { const view = new WebView(); try { await view.loadURL(url); await view.present(fullscreen); } finally { await view.close(); } }
    static async loadHTML(html, baseURL, preferredSize, fullscreen = false) { const view = new WebView(); try { await view.loadHTML(html, baseURL); await view.present(fullscreen); } finally { await view.close(); } }
    static async loadFile(fileURL, preferredSize, fullscreen = false) { const view = new WebView(); try { await view.loadFile(fileURL); await view.present(fullscreen); } finally { await view.close(); } }
    static async evaluateJavaScript(javaScript, useCallback = false) { const view = new WebView(); try { await view.loadHTML('<!doctype html><html><body></body></html>'); return await view.evaluateJavaScript(javaScript, useCallback); } finally { await view.close(); } }
  }
  track(WebView.prototype, ['loadURL', 'loadHTML', 'loadFile', 'loadRequest', 'evaluateJavaScript', 'getHTML', 'present', 'waitForLoad', 'close']);
  track(WebView, ['loadURL', 'loadHTML', 'loadFile', 'evaluateJavaScript']);

  class UITableCell {
    constructor(type = 'text') { this.type = type; this._id = uuid(); this.widthWeight = 1; this.dismissOnTap = false; this.onTap = null; this.alignment = 'left'; }
    static text(title = '', subtitle = '') { const cell = new UITableCell('text'); cell.title = String(title ?? ''); cell.subtitle = String(subtitle ?? ''); return cell; }
    static image(image) { if (!(image instanceof self.Image)) throw new TypeError('Expected an Image.'); const cell = new UITableCell('image'); cell.image = image; return cell; }
    static imageAtURL(url) { const cell = new UITableCell('image'); cell.imageURL = text(url, 'Image URL'); return cell; }
    static button(title) { const cell = new UITableCell('button'); cell.title = text(title, 'Button title'); return cell; }
    leftAligned() { this.alignment = 'left'; }
    centerAligned() { this.alignment = 'center'; }
    rightAligned() { this.alignment = 'right'; }
    toJSON() { const output = {}; for (const [key, value] of Object.entries(this)) if (!key.startsWith('_') && typeof value !== 'function') output[key] = value; output.cellId = this._id; output.tappable = typeof this.onTap === 'function'; return output; }
  }
  class UITableRow {
    constructor() { this._id = uuid(); this.cells = []; this.height = 44; this.cellSpacing = 0; this.isHeader = false; this.dismissOnSelect = true; this.onSelect = null; }
    addCell(cell) { if (!(cell instanceof UITableCell)) throw new TypeError('Expected a UITableCell.'); this.cells.push(cell); return cell; }
    addText(title, subtitle) { return this.addCell(UITableCell.text(title, subtitle)); }
    addImage(image) { return this.addCell(UITableCell.image(image)); }
    addImageAtURL(url) { return this.addCell(UITableCell.imageAtURL(url)); }
    addButton(title) { return this.addCell(UITableCell.button(title)); }
    toJSON() { const output = {}; for (const [key, value] of Object.entries(this)) if (!key.startsWith('_') && typeof value !== 'function') output[key] = value; output.rowId = this._id; output.selectable = typeof this.onSelect === 'function'; return output; }
  }
  class UITable {
    constructor() { this._id = uuid(); this.rows = []; this.showSeparators = false; this._presented = false; }
    addRow(row) { if (!(row instanceof UITableRow)) throw new TypeError('Expected a UITableRow.'); this.rows.push(row); }
    removeRow(row) { const index = this.rows.indexOf(row); if (index >= 0) this.rows.splice(index, 1); }
    removeAllRows() { this.rows.length = 0; }
    _payload() { return { tableId: this._id, rows: this.rows, showSeparators: !!this.showSeparators }; }
    reload() { if (this._presented) persist('table.reload', this._payload()); }
    async present(fullscreen = false) { if (this._presented) throw new Error('This table is already presented.'); this._presented = true; tables.set(this._id, this); try { return await host('table.present', { ...this._payload(), fullscreen: !!fullscreen }); } finally { this._presented = false; tables.delete(this._id); } }
  }
  track(UITable.prototype, ['present']);
  R.onEvent((event, id) => {
    if (event.type === 'navigation') {
      const view = webViews.get(event.webviewId);
      observe((async () => { let allowed = true; try { if (typeof view?.shouldAllowRequest === 'function') allowed = !!(await view.shouldAllowRequest({ url: event.url, method: event.method || 'GET', headers: event.headers || {} })); } catch (error) { allowed = false; self.console.error(error); } await host('webview.navigate', { webviewId: event.webviewId, navigationId: event.navigationId, allow: allowed }); })());
      return;
    }
    if (event.type === 'webLog') { (event.error ? self.console.error : self.console.log)(...(event.values || [])); return; }
    const table = tables.get(event.tableId); if (!table) return;
    const row = table.rows.find(item => item._id === event.rowId); if (!row) return;
    const cell = event.cellId ? row.cells.find(item => item._id === event.cellId) : null;
    const callback = event.type === 'tap' ? cell?.onTap : row.onSelect;
    if (typeof callback === 'function') observe(Promise.resolve().then(() => callback(event.index)));
  });

  class CallbackURL {
    constructor(baseURL) { this.baseURL = text(baseURL, 'Base URL'); this.parameters = []; }
    addParameter(name, value) { this.parameters.push([text(name, 'Parameter name'), text(value, 'Parameter value')]); }
    getURL() { const hashAt = this.baseURL.indexOf('#'), main = hashAt < 0 ? this.baseURL : this.baseURL.slice(0, hashAt), hash = hashAt < 0 ? '' : this.baseURL.slice(hashAt); const query = this.parameters.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join('&'); return main + (query ? (main.includes('?') ? '&' : '?') + query : '') + hash; }
    async open() { return host('callback.open', { url: this.getURL() }); }
  }
  track(CallbackURL.prototype, ['open']);
  const URLScheme = {
    forRunningScript() { const script = R.getcontext().script; return `scriptable-android://run?id=${encodeURIComponent(script.id)}&scriptName=${encodeURIComponent(script.name)}`; },
    forOpeningScript() { const script = R.getcontext().script; return `scriptable-android://open?id=${encodeURIComponent(script.id)}&scriptName=${encodeURIComponent(script.name)}`; },
    forOpeningScriptSettings() { return this.forOpeningScript() + '&settings=true'; },
    allParameters() { return { ...(self.args.queryParameters || {}) }; },
    async open(url) { return host('url.open', { url: text(url, 'URL') }); }
  };
  track(URLScheme, ['open']);
  self.Safari.openInApp = (url, fullscreen = false) => observe(host('safari.present', { url: text(url, 'URL'), fullscreen: !!fullscreen }));

  class LinearGradient {
    constructor() { this.colors = []; this.locations = []; this.startPoint = new self.Point(0, 0); this.endPoint = new self.Point(1, 1); }
    toJSON() {
      if (!Array.isArray(this.colors) || this.colors.some(color => !(color instanceof self.Color))) throw new TypeError('Gradient colors must contain Colors.');
      const locations = this.locations.length ? this.locations : this.colors.map((_, index) => index / Math.max(1, this.colors.length - 1));
      if (locations.length !== this.colors.length || locations.some((value, index) => !Number.isFinite(value) || value < 0 || value > 1 || index && value < locations[index - 1])) throw new Error('Gradient locations must be ascending values between 0 and 1, one per color.');
      return { colors: this.colors, locations, startPoint: this.startPoint, endPoint: this.endPoint };
    }
  }
  class WidgetDate extends self.WidgetText {
    constructor(date) { if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TypeError('Expected a valid Date.'); super(date.toLocaleDateString(self.Device.locale())); this.type = 'date'; this.date = date.toISOString(); this.dateStyle = 'date'; }
    applyTimeStyle() { this.dateStyle = 'time'; }
    applyDateStyle() { this.dateStyle = 'date'; }
    applyRelativeStyle() { this.dateStyle = 'relative'; }
    applyOffsetStyle() { this.dateStyle = 'offset'; }
    applyTimerStyle() { this.dateStyle = 'timer'; }
  }
  self.WidgetStack.prototype.addDate = function (date) { const child = new WidgetDate(date); this.children.push(child); return child; };
  for (const family of ['Circular', 'Rectangular', 'Inline']) self.ListWidget.prototype[`presentAccessory${family}`] = function () { return observe(this._present(`accessory${family}`)); };
  self.Script.setWidget = widget => {
    if (!(widget instanceof self.ListWidget)) throw new TypeError('Script.setWidget requires a ListWidget.');
    const tree = serial(widget), context = R.getcontext();
    self.postMessage({ type: 'widget', tree, family: self.config.widgetFamily || 'medium' });
    persist('widget.save', { tree, scriptId: context.script.id, parameter: self.args.widgetParameter, family: self.config.widgetFamily || 'medium', targetWidgetId: self.config.widgetId });
  };
  R.register({ WebView, UITable, UITableRow, UITableCell, CallbackURL, URLScheme, LinearGradient, WidgetDate });
})();
