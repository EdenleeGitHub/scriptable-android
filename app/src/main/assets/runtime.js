/* Scriptable-compatible Android runtime. One dedicated Worker is created per run. */
(() => {
  'use strict';
  const send = self.postMessage.bind(self);
  const nativeSetTimeout = self.setTimeout.bind(self);
  const nativeClearTimeout = self.clearTimeout.bind(self);
  const pending = new Map();
  const activeTimers = new Set();
  const apiOperations = [], observations = new WeakMap();
  const eventListeners = new Set();
  let nextId = 1, context = {}, hasRun = false, completed = false;
  let persistence = Promise.resolve(), persistenceError = null, timerError = null, shortcutOutput;
  const unsupported = name => { throw new Error(`${name} is not supported in this Android version.`); };
  const clean = value => {
    try { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item)); }
    catch (_) { return String(value); }
  };
  const host = (action, payload = {}) => {
    const id = nextId++;
    const operation = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ type: 'host', id, action, payload: clean(payload) });
    });
    if (pending.has(id)) pending.get(id).promise = operation;
    // The final drain surfaces native failures for calls made without await.
    operation.catch(() => {});
    return operation;
  };
  // Scriptable file/keychain writes are synchronous. Persist them in order and
  // report a native failure before reporting completion, even without an await.
  function persist(action, payload) {
    persistence = persistence.then(() => host(action, payload));
    persistence.catch(error => { persistenceError = error; });
  }
  class RuntimePromise extends Promise {
    static get [Symbol.species]() { return Promise; }
    then(onFulfilled, onRejected) {
      const record = observations.get(this);
      if (record) record.observed = true;
      return super.then(onFulfilled, onRejected);
    }
  }
  function observe(operation) {
    const promise = new RuntimePromise((resolve, reject) => Promise.resolve(operation).then(resolve, reject));
    const record = { promise, observed: false, error: null };
    observations.set(promise, record); apiOperations.push(record);
    // Bypass the public then override: this monitor is not a script await/catch.
    record.monitor = Promise.prototype.then.call(promise, () => {}, error => { record.error = error; });
    return promise;
  }
  function observeMethods(target, methods) {
    for (const name of methods) {
      const implementation = target[name];
      target[name] = function (...args) { return observe(implementation.apply(this, args)); };
    }
  }
  function string(value, label) {
    if (typeof value !== 'string') throw new TypeError(`${label} must be a string.`);
    return value;
  }
  function finite(value, label) {
    if (!Number.isFinite(Number(value))) throw new TypeError(`${label} must be a finite number.`);
    return Number(value);
  }
  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  }
  function base64ToBytes(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  }
  class Data {
    constructor(bytes) { this._bytes = new Uint8Array(bytes || []); }
    static fromString(value) { return new Data(new TextEncoder().encode(string(value, 'String'))); }
    static fromBase64String(value) { try{return new Data(base64ToBytes(string(value, 'Base64 string')));}catch(_){return null;} }
    static fromJPEG(image) { if (!(image instanceof Image)) throw new TypeError('Expected an Image.'); if (image.mimeType !== 'image/jpeg') unsupported('Data.fromJPEG image conversion'); return image.data; }
    static fromPNG(image) { if (!(image instanceof Image)) throw new TypeError('Expected an Image.'); if (image.mimeType !== 'image/png') unsupported('Data.fromPNG image conversion'); return image.data; }
    getBytes() { return Array.from(this._bytes); }
    toRawString() { try{return new TextDecoder('utf-8',{fatal:true}).decode(this._bytes);}catch(_){return null;} }
    toBase64String() { return bytesToBase64(this._bytes); }
    toJSON() { return { base64: this.toBase64String() }; }
  }
  class Image {
    constructor(data, mimeType = 'image/png') { this.data = data; this.mimeType = mimeType; }
    static fromData(data) { if (!(data instanceof Data)) throw new TypeError('Expected Data.'); return new Image(data); }
    static fromFile(path) { return FileManager.local().readImage(path); }
    toJSON() { return `data:${this.mimeType};base64,${this.data.toBase64String()}`; }
  }
  class Request {
    constructor(url) { this.url = string(url, 'URL'); this.method = 'GET'; this.headers = {}; this.body = null; this.timeoutInterval = 60; this.response = null; this.allowInsecureRequest = false; }
    async _load(encoding) {
      if (this.allowInsecureRequest) unsupported('Request.allowInsecureRequest');
      if (this.onRedirect) unsupported('Request.onRedirect');
      if (!(this.body == null || typeof this.body === 'string' || this.body instanceof Data)) throw new TypeError('Request.body must be a string or Data.');
      const reply = await host('request', { url: this.url, method: this.method, headers: this.headers, body: this.body, timeoutInterval: this.timeoutInterval, encoding });
      this.response = { url: reply.url || this.url, statusCode: reply.statusCode, headers: reply.headers || {}, mimeType: reply.mimeType || '', textEncodingName: reply.textEncodingName || 'utf-8', cookies: reply.cookies || [] };
      return reply.body;
    }
    async loadString() { return await this._load('text'); }
    async loadJSON() { return JSON.parse(await this.loadString()); }
    async load() { return Data.fromBase64String(await this._load('base64')); }
    async loadImage() { const data = await this.load(); return new Image(data, this.response.mimeType || 'image/png'); }
    addParameterToMultipart() { unsupported('Request multipart uploads'); }
    addFileDataToMultipart() { unsupported('Request multipart uploads'); }
    addFileToMultipart() { unsupported('Request multipart uploads'); }
    addImageToMultipart() { unsupported('Request multipart uploads'); }
  }
  let files = {};
  function pathOf(value) {
    const input = string(value, 'Path').replace(/\\/g, '/');
    const parts = [];
    for (const part of input.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!parts.length) throw new Error('Path escapes app storage.'); parts.pop(); }
      else parts.push(part);
    }
    const path = '/' + parts.join('/');
    if (!['documents', 'cache', 'temporary', 'library', 'cloud', 'bookmarks'].includes(parts[0])) throw new Error('Paths must be inside app storage or a linked Android document folder.');
    return path;
  }
  const parentPath = path => path.slice(0, path.lastIndexOf('/'));
  const fileEntry = path => {
    path = pathOf(path);
    if (!Object.prototype.hasOwnProperty.call(files, path)) throw new Error(`File does not exist: ${path}`);
    return files[path];
  };
  const ensureParent = path => {
    const parent = files[parentPath(path)];
    if (!parent || parent.type !== 'directory') throw new Error(`Parent directory does not exist: ${parentPath(path)}`);
  };
  const rootPath = path => ['/documents', '/cache', '/temporary', '/library', '/cloud', '/bookmarks'].includes(path);
  class FileManager {
    static local() { return new FileManager(); }
    static iCloud() { unsupported('FileManager.iCloud'); }
    documentsDirectory() { return '/documents'; }
    cacheDirectory() { return '/cache'; }
    temporaryDirectory() { return '/temporary'; }
    libraryDirectory() { return '/library'; }
    joinPath(left, right) { return pathOf(string(left, 'Left path') + '/' + string(right, 'Right path')); }
    fileExists(path) { return Object.prototype.hasOwnProperty.call(files, pathOf(path)); }
    isDirectory(path) { return fileEntry(path).type === 'directory'; }
    readString(path) { const entry = fileEntry(path); if (entry.type !== 'file') throw new Error('Cannot read a directory.'); return entry.text !== undefined ? entry.text : Data.fromBase64String(entry.base64 || '').toRawString(); }
    read(path) { const entry = fileEntry(path); if (entry.type !== 'file') throw new Error('Cannot read a directory.'); return entry.base64 !== undefined ? Data.fromBase64String(entry.base64) : Data.fromString(entry.text || ''); }
    readImage(path) { return Image.fromData(this.read(path)); }
    writeString(path, text) {
      path = pathOf(path); text = string(text, 'File contents'); ensureParent(path);
      if (files[path]?.type === 'directory') throw new Error('Cannot overwrite a directory.');
      files[path] = { type: 'file', text, modifiedAt: Date.now() };
      persist('file.op', { op: 'writeString', path, text });
    }
    write(path, data) {
      path = pathOf(path); if (!(data instanceof Data)) throw new TypeError('Expected Data.'); ensureParent(path);
      if (files[path]?.type === 'directory') throw new Error('Cannot overwrite a directory.');
      const base64 = data.toBase64String(); files[path] = { type: 'file', base64, modifiedAt: Date.now() };
      persist('file.op', { op: 'write', path, base64 });
    }
    writeImage(path, image) { if (!(image instanceof Image)) throw new TypeError('Expected Image.'); this.write(path, image.data); }
    remove(path) {
      path = pathOf(path); fileEntry(path); if (rootPath(path)) throw new Error('Cannot remove a storage root.');
      for (const key of Object.keys(files)) if (key === path || key.startsWith(path + '/')) delete files[key];
      persist('file.op', { op: 'remove', path });
    }
    _transfer(path, destination, op) {
      path = pathOf(path); destination = pathOf(destination); fileEntry(path); ensureParent(destination);
      if (rootPath(path) || rootPath(destination)) throw new Error('Cannot move or overwrite a storage root.');
      if (this.fileExists(destination)) throw new Error('Destination already exists.');
      if (destination === path || destination.startsWith(path + '/')) throw new Error('Destination cannot be inside the source.');
      for (const key of Object.keys(files)) if (key === path || key.startsWith(path + '/')) {
        files[destination + key.slice(path.length)] = { ...files[key] };
        if (op === 'move') delete files[key];
      }
      persist('file.op', { op, path, destination });
    }
    move(path, destination) { this._transfer(path, destination, 'move'); }
    copy(path, destination) { this._transfer(path, destination, 'copy'); }
    createDirectory(path, intermediates = false) {
      path = pathOf(path);
      if (files[path]) { if (files[path].type !== 'directory') throw new Error('A file already exists at this path.'); return; }
      if (!intermediates) ensureParent(path);
      const paths = path.split('/');
      for (let count = 2; count <= paths.length; count++) {
        const segment = paths.slice(0, count).join('/');
        if (files[segment]?.type === 'file') throw new Error('A parent path is a file.');
        if (!files[segment]) { files[segment] = { type: 'directory', modifiedAt: Date.now() }; persist('file.op', { op: 'createDirectory', path: segment }); }
      }
    }
    listContents(path) {
      path = pathOf(path); if (!this.isDirectory(path)) throw new Error('Expected a directory.');
      return Object.keys(files).filter(key => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/')).map(key => key.slice(path.length + 1)).sort();
    }
    fileName(path, includeExtension = false) { const name = pathOf(path).split('/').pop(); return includeExtension ? name : name.replace(/\.[^.]+$/, ''); }
    fileExtension(path) { const name = pathOf(path).split('/').pop(); const dot = name.lastIndexOf('.'); return dot > 0 ? name.slice(dot + 1) : ''; }
    modificationDate(path) { const entry = fileEntry(path); return entry.modifiedAt ? new Date(entry.modifiedAt) : null; }
    creationDate(path) { const entry = fileEntry(path); return entry.createdAt ? new Date(entry.createdAt) : null; }
    fileSize(path) { return this.read(path)._bytes.byteLength; }
    isFileStoredIniCloud() { return false; }
    isFileDownloaded(path) { return this.fileExists(path); }
    downloadFileFromiCloud() { unsupported('FileManager.downloadFileFromiCloud'); }
  }
  const keychain = () => context.keychain;
  const Keychain = {
    contains(key) { return Object.prototype.hasOwnProperty.call(keychain(), string(key, 'Key')); },
    get(key) { if (!this.contains(key)) throw new Error(`Keychain key does not exist: ${key}`); return keychain()[key]; },
    set(key, value) { key = string(key, 'Key'); value = string(value, 'Value'); keychain()[key] = value; persist('keychain.op', { op: 'set', key, value }); },
    remove(key) { key = string(key, 'Key'); delete keychain()[key]; persist('keychain.op', { op: 'remove', key }); }
  };
  class Alert {
    constructor() { this.title = ''; this.message = ''; this._actions = []; this._cancel = null; this._fields = []; }
    addAction(title) { this._actions.push({ title: string(title, 'Action title'), destructive: false }); }
    addDestructiveAction(title) { this._actions.push({ title: string(title, 'Action title'), destructive: true }); }
    addCancelAction(title) { this._cancel = string(title, 'Cancel title'); }
    addTextField(placeholder = '', value = '') { this._fields.push({ placeholder, value, secure: false }); }
    addSecureTextField(placeholder = '', value = '') { this._fields.push({ placeholder, value, secure: true }); }
    textFieldValue(index) { if (!this._fields[index]) throw new RangeError('Text field index is out of range.'); return this._fields[index].value; }
    async presentAlert() {
      const result = await host('alert', { title: this.title, message: this.message, actions: this._actions, cancel: this._cancel, textFields: this._fields });
      (result.values || []).forEach((value, index) => { if (this._fields[index]) this._fields[index].value = value; });
      return result.index;
    }
    async presentSheet() { if (this._fields.length) throw new Error('Sheets do not support text fields.'); return await this.presentAlert(); }
    async present() { return await this.presentAlert(); }
  }
  class Point { constructor(x, y) { this.x = finite(x, 'x'); this.y = finite(y, 'y'); } }
  class Size { constructor(width, height) { this.width = finite(width, 'width'); this.height = finite(height, 'height'); } }
  class Rect {
    constructor(x, y, width, height) { this.x = finite(x, 'x'); this.y = finite(y, 'y'); this.width = finite(width, 'width'); this.height = finite(height, 'height'); }
    get origin() { return new Point(this.x, this.y); }
    set origin(value) { this.x = value.x; this.y = value.y; }
    get size() { return new Size(this.width, this.height); }
    set size(value) { this.width = value.width; this.height = value.height; }
  }
  class Color {
    constructor(hex, alpha = 1) {
      hex = string(hex, 'Hex color').replace(/^#/, '');
      if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.split('').map(char => char + char).join('');
      if (!/^[0-9a-f]{6}$/i.test(hex)) throw new Error('Color requires a 3 or 6 digit hexadecimal value.');
      this.hex = hex.toUpperCase(); this.alpha = Math.max(0, Math.min(1, finite(alpha, 'Alpha')));
      this.red = parseInt(hex.slice(0, 2), 16) / 255; this.green = parseInt(hex.slice(2, 4), 16) / 255; this.blue = parseInt(hex.slice(4, 6), 16) / 255;
    }
    toJSON() { return '#' + this.hex + (this.alpha < 1 ? Math.round(this.alpha * 255).toString(16).padStart(2, '0') : ''); }
    static dynamic(light, dark) { return Device.isUsingDarkAppearance() ? dark : light; }
  }
  const colors = { black: '000000', darkGray: '555555', lightGray: 'AAAAAA', white: 'FFFFFF', gray: '888888', red: 'FF3B30', green: '34C759', blue: '007AFF', cyan: '32ADE6', yellow: 'FFCC00', magenta: 'FF2D55', orange: 'FF9500', purple: 'AF52DE', brown: 'A2845E' };
  for (const [name, hex] of Object.entries(colors)) Color[name] = () => new Color(hex);
  Color.clear = () => new Color('000000', 0);
  class Font { constructor(name, size) { this.family = string(name, 'Font name'); this.size = finite(size, 'Font size'); this.weight = 'normal'; } }
  for (const [name, weight] of Object.entries({ systemFont: 'normal', ultraLightSystemFont: '100', thinSystemFont: '200', lightSystemFont: '300', regularSystemFont: 'normal', mediumSystemFont: '500', semiboldSystemFont: '600', boldSystemFont: 'bold', heavySystemFont: '800', blackSystemFont: '900', italicSystemFont: 'normal' })) Font[name] = size => { const font = new Font('sans-serif', size); font.weight = weight; if (name === 'italicSystemFont') font.style = 'italic'; return font; };
  for (const weight of ['regular', 'medium', 'semibold', 'bold']) Font[weight + 'MonospacedSystemFont'] = size => { const font = new Font('monospace', size); font.weight = weight === 'regular' ? 'normal' : weight === 'bold' ? 'bold' : weight === 'medium' ? '500' : '600'; return font; };
  for (const [name, size] of Object.entries({ largeTitle: 34, title1: 28, title2: 22, title3: 20, headline: 17, subheadline: 15, body: 17, callout: 16, footnote: 13, caption1: 12, caption2: 11 })) Font[name] = () => Font.systemFont(size);
  class WidgetNode {
    constructor(type) { this.type = type; }
    toJSON() {
      const result = {};
      for (const [key, value] of Object.entries(this)) if (!key.startsWith('_') && value !== undefined) result[key] = value;
      if (this.textColor !== undefined) result.color = this.textColor;
      return result;
    }
  }
  class WidgetText extends WidgetNode {
    constructor(text) { super('text'); this.text = String(text); this.font = Font.systemFont(15); }
    leftAlignText() { this.alignment = 'left'; }
    centerAlignText() { this.alignment = 'center'; }
    rightAlignText() { this.alignment = 'right'; }
  }
  class WidgetImage extends WidgetNode {
    constructor(image) { super('image'); if (!(image instanceof Image)) throw new TypeError('Widget image must be an Image.'); this.image = image; }
    leftAlignImage() { this.alignment = 'left'; }
    centerAlignImage() { this.alignment = 'center'; }
    rightAlignImage() { this.alignment = 'right'; }
    applyFittingContentMode() { this.contentMode = 'fit'; }
    applyFillingContentMode() { this.contentMode = 'fill'; }
  }
  class WidgetSpacer extends WidgetNode { constructor(length) { super('spacer'); if (length !== undefined) this.length = finite(length, 'Spacer length'); } }
  class WidgetStack extends WidgetNode {
    constructor(type = 'stack') { super(type); this.children = []; this.layout = type === 'widget' ? 'vertical' : 'horizontal'; this.spacing = 0; }
    addText(value) { const child = new WidgetText(value); this.children.push(child); return child; }
    addImage(value) { const child = new WidgetImage(value); this.children.push(child); return child; }
    addSpacer(length) { const child = new WidgetSpacer(length); this.children.push(child); return child; }
    addStack() { const child = new WidgetStack(); this.children.push(child); return child; }
    addDate(date) { const child = this.addText(date.toLocaleString(context.device.locale || undefined)); child.date = date.toISOString(); return child; }
    layoutHorizontally() { this.layout = 'horizontal'; }
    layoutVertically() { this.layout = 'vertical'; }
    setPadding(top, left, bottom, right) { this.padding = [top, left, bottom, right].map(value => finite(value, 'Padding')); }
    useDefaultPadding() { delete this.padding; }
    topAlignContent() { this.alignment = 'top'; }
    centerAlignContent() { this.alignment = 'center'; }
    bottomAlignContent() { this.alignment = 'bottom'; }
  }
  class ListWidget extends WidgetStack {
    constructor() { super('widget'); this.backgroundColor = new Color('192638'); this.padding = [16, 16, 16, 16]; }
    _present(family) { send({ type: 'widget', tree: clean(this), family }); return Promise.resolve(); }
    presentSmall() { return this._present('small'); }
    presentMedium() { return this._present('medium'); }
    presentLarge() { return this._present('large'); }
    presentExtraLarge() { return this._present('extraLarge'); }
    presentAccessoryCircular() { return Promise.reject(new Error('Lock screen accessory widgets are not supported on Android.')); }
    presentAccessoryRectangular() { return this.presentAccessoryCircular(); }
    presentAccessoryInline() { return this.presentAccessoryCircular(); }
  }
  const Script = {
    name() { return context.script.name; },
    setWidget(widget) { if (!(widget instanceof ListWidget)) throw new TypeError('Script.setWidget requires a ListWidget.'); const tree = clean(widget); send({ type: 'widget', tree }); persist('widget.save', { tree, scriptId: context.script.id }); },
    setShortcutOutput(value) { shortcutOutput = clean(value); },
    complete() { completed = true; for (const timer of Array.from(activeTimers)) timer.invalidate(); }
  };
  const Device = {
    name: () => context.device.name || 'Android', model: () => context.device.model || 'Android', systemName: () => context.device.systemName || 'Android', systemVersion: () => context.device.systemVersion || '',
    batteryLevel: () => context.device.batteryLevel ?? -1, isCharging: () => !!context.device.isCharging, isDischarging: () => !context.device.isCharging, isFullyCharged: () => context.device.batteryLevel === 1,
    screenSize: () => new Size(context.device.screenSize?.width || 0, context.device.screenSize?.height || 0),
    screenScale: () => context.device.screenScale || 1,
    screenResolution() { const size = this.screenSize(); return new Size(size.width * this.screenScale(), size.height * this.screenScale()); },
    isPhone: () => Math.min(context.device.screenSize?.width || 0, context.device.screenSize?.height || 0) < 600,
    isPad: () => !Device.isPhone(), isInPortrait: () => Device.screenSize().height >= Device.screenSize().width,
    locale: () => context.device.locale || 'en-US', language: () => Device.locale().split(/[-_]/)[0], preferredLanguages: () => [Device.locale()],
    isUsingDarkAppearance: () => !!context.device.isDark,
    screenBrightness: () => unsupported('Device.screenBrightness'), setScreenBrightness: () => unsupported('Device.setScreenBrightness'), volume: () => unsupported('Device.volume')
  };
  const Pasteboard = {
    copyString(text) { context.clipboard = string(text, 'Clipboard text'); persist('clipboard.write', { text }); },
    pasteString() { return context.clipboard ?? null; },
    copy(text) { this.copyString(text); }, paste() { return this.pasteString(); },
    async readString() { context.clipboard = await host('clipboard.read'); return context.clipboard; },
    copyImage() { unsupported('Pasteboard.copyImage'); }, pasteImage() { unsupported('Pasteboard.pasteImage'); }
  };
  class Notification {
    constructor() { this.title = ''; this.subtitle = ''; this.body = ''; this.sound = 'default'; this.identifier = UUID.string(); }
    async schedule() { if (this._trigger) unsupported('Scheduled notification triggers'); return await host('notification.schedule', { title: this.title, subtitle: this.subtitle, body: this.body, sound: this.sound, identifier: this.identifier, openURL: this.openURL }); }
    setTriggerDate(date) { this._trigger = date; }
    setDailyTrigger() { unsupported('Notification.setDailyTrigger'); }
    setWeeklyTrigger() { unsupported('Notification.setWeeklyTrigger'); }
    addAction() { unsupported('Notification.addAction'); }
    static allPending() { unsupported('Notification.allPending'); }
    static allDelivered() { unsupported('Notification.allDelivered'); }
  }
  const Safari = { open: url => host('safari.open', { url: string(url, 'URL') }), openInApp: url => host('safari.open', { url: string(url, 'URL') }) };
  const QuickLook = { async present(value) { send({ type: 'preview', value: value instanceof Image ? value.toJSON() : value instanceof Data ? value.toRawString() : typeof value === 'string' ? value : JSON.stringify(clean(value), null, 2), format: value instanceof Image ? 'image' : 'text' }); } };
  const ShareSheet = { async present(values) { if (!Array.isArray(values)) throw new TypeError('ShareSheet.present expects an array.'); if (values.some(value => value instanceof Image || value instanceof Data)) unsupported('Binary ShareSheet content'); return await host('share', { text: values.map(value => typeof value === 'string' ? value : JSON.stringify(clean(value))).join('\n') }); } };
  const Speech = { speak: (text, language) => host('speech', { text: string(text, 'Speech text'), language: language || Device.language() }) };
  const UUID = { string() { if (self.crypto?.randomUUID) return self.crypto.randomUUID(); const bytes = new Uint8Array(16); if (self.crypto?.getRandomValues) self.crypto.getRandomValues(bytes); else for (let i = 0; i < 16; i++) bytes[i] = Math.random() * 256; bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128; const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`; } };
  class Timer {
    constructor() { this.timeInterval = 0; this.repeats = false; this._handle = null; this._valid = false; this._running = false; }
    static schedule(timeInterval, repeats, callback) { const timer = new Timer(); timer.timeInterval = timeInterval; timer.repeats = repeats; timer.schedule(callback); return timer; }
    schedule(callback) {
      if (typeof callback !== 'function') throw new TypeError('Timer callback must be a function.');
      this.invalidate(); this._valid = true; activeTimers.add(this);
      const fire = async () => {
        if (!this._valid) return;
        this._running = true;
        try { await callback(); } catch (error) { timerError = error; this._valid = false; }
        this._running = false;
        if (this._valid && this.repeats && !completed && !timerError) this._handle = nativeSetTimeout(fire, Math.max(1, finite(this.timeInterval, 'Timer interval')));
        else this.invalidate();
      };
      this._handle = nativeSetTimeout(fire, Math.max(0, finite(this.timeInterval, 'Timer interval')));
    }
    invalidate() { this._valid = false; if (this._handle !== null) nativeClearTimeout(this._handle); this._handle = null; if (!this._running) activeTimers.delete(this); }
  }
  class DateFormatter {
    constructor() { this.locale = Device.locale(); this.dateFormat = ''; this._dateStyle = 'medium'; this._timeStyle = null; }
    string(date) {
      if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TypeError('Expected a valid Date.');
      if (!this.dateFormat) {
        const options = {}; if (this._dateStyle) options.dateStyle = this._dateStyle; if (this._timeStyle) options.timeStyle = this._timeStyle;
        return Object.keys(options).length ? new Intl.DateTimeFormat(this.locale.replace(/_/g, '-'), options).format(date) : '';
      }
      const pad = number => String(number).padStart(2, '0');
      const localized = options => new Intl.DateTimeFormat(this.locale.replace(/_/g, '-'), options).format(date);
      const tokens = { yyyy: String(date.getFullYear()).padStart(4, '0'), yy: pad(date.getFullYear() % 100), MMMM: localized({ month: 'long' }), MMM: localized({ month: 'short' }), MM: pad(date.getMonth() + 1), M: String(date.getMonth() + 1), dd: pad(date.getDate()), d: String(date.getDate()), EEEE: localized({ weekday: 'long' }), EEE: localized({ weekday: 'short' }), HH: pad(date.getHours()), H: String(date.getHours()), hh: pad(date.getHours() % 12 || 12), h: String(date.getHours() % 12 || 12), mm: pad(date.getMinutes()), m: String(date.getMinutes()), ss: pad(date.getSeconds()), s: String(date.getSeconds()), a: date.getHours() < 12 ? 'AM' : 'PM' };
      return this.dateFormat.replace(/'((?:[^']|'')*)'|yyyy|MMMM|EEEE|MMM|EEE|yy|MM|dd|HH|hh|mm|ss|M|d|H|h|m|s|a|[A-Za-z]+/g, (token, literal) => { if (literal !== undefined) return literal.replace(/''/g, "'"); if (tokens[token] !== undefined) return tokens[token]; throw new Error(`Unsupported DateFormatter token: ${token}`); });
    }
    date(value) { if (this.dateFormat) unsupported('DateFormatter.date with custom formats'); const date = new Date(value); return Number.isFinite(date.getTime()) ? date : null; }
  }
  for (const [name, style] of Object.entries({ No: null, Short: 'short', Medium: 'medium', Long: 'long', Full: 'full' })) { DateFormatter.prototype[`use${name}DateStyle`] = function () { this._dateStyle = style; }; DateFormatter.prototype[`use${name}TimeStyle`] = function () { this._timeStyle = style; }; }
  const moduleCache = new Map();
  function importModule(name) {
    name = string(name, 'Module name').replace(/\.js$/, '');
    const script = (context.scripts || []).find(item => item.name.replace(/\.js$/, '') === name || item.id === name);
    let code = script?.code, filename = script ? `/documents/${script.name}.js` : pathOf(name.startsWith('/') ? name + '.js' : '/documents/' + name + '.js');
    if(code===undefined&&!files[filename]&&!name.startsWith('/')&&files['/cloud/'+name+'.js'])filename=pathOf('/cloud/'+name+'.js');
    if (code === undefined) { if (!files[filename]) throw new Error(`Module not found: ${name}`); code = FileManager.local().readString(filename); }
    if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
    const module = { exports: {}, filename }; moduleCache.set(filename, module);
    try { const localImport=child=>importModule(typeof child==='string'&&child.startsWith('.')?pathOf(filename.slice(0,filename.lastIndexOf('/')+1)+child):child);new Function('module', 'exports', 'importModule', 'require', '"use strict";\n' + code + `\n//# sourceURL=${filename.replace(/[\r\n]/g, '')}`)(module, module.exports, localImport, localImport); }
    catch (error) { moduleCache.delete(filename); throw error; }
    return module.exports;
  }
  // An unawaited Android action must still finish before Worker teardown, and
  // its failure must reach the output pane. Awaited/caught failures remain
  // catchable so scripts can intentionally recover and render a fallback.
  observeMethods(Request.prototype, ['loadString', 'loadJSON', 'load', 'loadImage']);
  observeMethods(Alert.prototype, ['presentAlert', 'presentSheet', 'present']);
  observeMethods(Notification.prototype, ['schedule']);
  observeMethods(Pasteboard, ['readString']);
  observeMethods(Safari, ['open', 'openInApp']);
  observeMethods(QuickLook, ['present']);
  observeMethods(ShareSheet, ['present']);
  observeMethods(Speech, ['speak']);
  observeMethods(ListWidget.prototype, ['presentSmall', 'presentMedium', 'presentLarge', 'presentExtraLarge', 'presentAccessoryCircular', 'presentAccessoryRectangular', 'presentAccessoryInline']);
  const scriptConsole = {};
  for (const level of ['log', 'warn', 'error', 'info', 'debug']) scriptConsole[level] = (...values) => send({ type: 'log', level, values: values.map(value => value instanceof Error ? { message: value.message, stack: value.stack } : clean(value)) });
  scriptConsole.table = value => scriptConsole.log(value);
  const globals = { Data, Image, Request, FileManager, Keychain, Alert, Point, Size, Rect, Color, Font, WidgetText, WidgetImage, WidgetSpacer, WidgetStack, ListWidget, Script, Device, Pasteboard, Notification, Safari, QuickLook, ShareSheet, Speech, UUID, Timer, DateFormatter, importModule, console: scriptConsole, log: scriptConsole.log };
  // Accesses to unavailable integrations fail explicitly instead of pretending
  // to succeed and losing user data or silently omitting automation.
  for (const name of ['Calendar', 'CalendarEvent', 'Contact', 'ContactsContainer', 'ContactsGroup', 'Location', 'Photos', 'Reminder', 'RecurrenceRule', 'Mail', 'Message', 'Dictation', 'DocumentPicker', 'DrawContext', 'Path', 'SFSymbol', 'UITable', 'UITableRow', 'UITableCell', 'WebView', 'CallbackURL', 'URLScheme', 'LinearGradient', 'XMLParser', 'DatePicker', 'RelativeDateTimeFormatter']) {
    globals[name] = new Proxy(function () { unsupported(name); }, { construct() { unsupported(name); }, get(_, property) { if (property === 'then') return undefined; return () => unsupported(name + '.' + String(property)); } });
  }
  Object.assign(self, globals);
  self.onmessage = async event => {
    const message = event.data;
    if (message.type === 'hostEvent') {
      for (const listener of eventListeners) { try { const result=listener(message.event,message.id); if(result?.then)observe(result); } catch(error) { timerError=error; } }
      return;
    }
    if (message.type === 'hostResult') {
      const callback = pending.get(message.id); if (!callback) return;
      pending.delete(message.id);
      if (message.ok) callback.resolve(message.result); else callback.reject(new Error(message.error || 'Native operation failed.'));
      return;
    }
    if (message.type !== 'run' || hasRun) return;
    hasRun = true;
    context = { script: { id: '', name: 'Untitled' }, device: {}, keychain: {}, args: {}, config: {}, ...message.context };
    context.keychain = Object.assign(Object.create(null), context.keychain || {}); files = { ...(context.files || {}) };
    for (const path of ['/documents', '/cache', '/temporary', '/library']) if (!files[path]) files[path] = { type: 'directory' };
    self.args = { plainTexts: [], urls: [], images: [], fileURLs: [], queryParameters: {}, shortcutParameter: null, widgetParameter: null,notification:null, ...context.args };
    Object.defineProperties(self.args,{all:{get(){return [...this.plainTexts,...this.urls,...this.images,...this.fileURLs];}},length:{get(){return this.all.length;}},siriShortcutArguments:{get(){return this.shortcutParameter;}}});
    self.module={exports:{},filename:'/documents/'+context.script.name+'.js'};
    self.require=importModule;
    self.config = { runsInApp: true, runsInWidget: false, runsWithSiri: false, runsInActionExtension: false,runsInAccessoryWidget:false,runsInNotification:false,runsFromHomeScreen:false, widgetFamily: 'medium', ...context.config };
    self.config.runsInAccessoryWidget=!!self.config.runsInWidget&&String(self.config.widgetFamily).startsWith('accessory');
    self.__runtime = {
      host, persist, observe, send, clean,
      register(map) { Object.assign(self,map); },
      get context() { return context; }, getcontext() { return context; },
      get files() { return files; }, getfiles() { return files; },
      updateFiles(entries) { Object.assign(files,entries); },
      onEvent(listener) { eventListeners.add(listener); return ()=>eventListeners.delete(listener); },
      syncHost(action,payload={}) {
        if (typeof XMLHttpRequest !== 'function') throw new Error('Native synchronous API is unavailable in this environment.');
        const endpoint=context.nativeSyncUrl || new URL('native-sync',self.location.href).href;
        if(context.nativeRuntime===false&&action.startsWith('device.')){
          const d=context.device||{};
          if(action==='device.battery')return {level:d.batteryLevel??-1,isCharging:!!d.isCharging,isDischarging:d.isDischarging??false,isFullyCharged:d.batteryLevel===1};
          if(action==='device.screen')return {widthPixels:(d.screenSize?.width||0)*(d.screenScale||1),heightPixels:(d.screenSize?.height||0)*(d.screenScale||1)};
          if(action==='device.preferredLanguages')return d.preferredLanguages||[d.locale||'en-US'];
          if(action==='device.orientation')return {isInPortrait:(d.screenSize?.height||0)>=(d.screenSize?.width||0),isInPortraitUpsideDown:false,isInLandscapeLeft:(d.screenSize?.height||0)<(d.screenSize?.width||0),isInLandscapeRight:false,isFaceUp:false,isFaceDown:false};
          throw new Error('Device hardware control requires the Android installation.');
        }
        const token=encodeURIComponent(context.nativeToken || ''),raw=JSON.stringify(clean(payload));
        const rpc=url=>{const request=new XMLHttpRequest();request.open('GET',url,false);request.send();if(request.status!==200)throw new Error('Native API failed with status '+request.status);const response=JSON.parse(request.responseText);if(!response.ok)throw new Error(response.error||'Native API failed');return response.result;};
        const url=endpoint+'?action='+encodeURIComponent(action)+'&payload='+encodeURIComponent(raw)+'&token='+token;
        if(url.length<1500000)return rpc(url);
        if(raw.length>16*1024*1024)throw new Error('Native image operation exceeds the 16MB transport limit.');
        const id=self.UUID.string(),chunk=endpoint.replace(/native-sync$/,'native-chunk')+'?token='+token+'&id='+encodeURIComponent(id);
        rpc(chunk+'&phase=begin&action='+encodeURIComponent(action)+'&length='+raw.length);
        let index=0;
        try{for(let start=0;start<raw.length;){let end=Math.min(raw.length,start+96000);if(end<raw.length&&/[\uD800-\uDBFF]/.test(raw[end-1]))end--;rpc(chunk+'&phase=append&index='+index+++'&data='+encodeURIComponent(raw.slice(start,end)));start=end;}return rpc(chunk+'&phase=execute');}
        catch(error){try{rpc(chunk+'&phase=cancel');}catch(_){}throw error;}
      }
    };
    if (typeof importScripts === 'function') {
      try { importScripts('runtime-graphics.js','runtime-system.js','runtime-ui.js','runtime-extra.js','runtime-compat.js','runtime-symbols.js','runtime-library.js','runtime-platform.js'); }
      catch(error) { send({type:'error',message:'API extension failed: '+error.message,stack:String(error.stack || '')}); return; }
    }
    self.args.images=(self.args.images||[]).map(image=>image instanceof self.Image?image:image&&typeof image==='object'&&image.base64?new self.Image(self.Data.fromBase64String(image.base64),image.mimeType||'image/png'):image);
    self.AndroidAutomation={
      pinShortcut(scriptId=context.script.id){return observe(host('shortcut.pin',{scriptId}));},
      openAlarmSettings(){return observe(host('alarm.settings',{}));},
      requestBackgroundLocation(){return self.Location.requestBackgroundAccess();}
    };
    let error = null;
    try {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      await new AsyncFunction('"use strict";\n' + string(message.code, 'Script code') + '\n//# sourceURL=script.js')();
      while (activeTimers.size) {
        if (timerError) throw timerError;
        await new Promise(resolve => nativeSetTimeout(resolve, 5));
      }
      if (timerError) throw timerError;
    } catch (failure) { error = failure; for (const timer of Array.from(activeTimers)) timer.invalidate(); }
    try { await persistence; } catch (failure) { if (!error) error = failure; }
    if (persistenceError && !error) error = persistenceError;
    let observedCount;
    do {
      observedCount = apiOperations.length;
      await Promise.all(apiOperations.map(operation => operation.monitor));
    } while (observedCount !== apiOperations.length);
    const unobservedFailure = apiOperations.find(operation => !operation.observed && operation.error);
    if (unobservedFailure && !error) error = unobservedFailure.error;
    // Alert, request and Android actions may be invoked without an explicit
    // await. Do not terminate their Worker before their native reply arrives.
    while (pending.size) {
      const results = await Promise.allSettled(Array.from(pending.values(), callback => callback.promise));
      const failure = results.find(result => result.status === 'rejected');
      if (failure && !error) error = failure.reason;
    }
    if (error) send({ type: 'error', message: String(error.message || error), stack: String(error.stack || '') });
    else send({ type: 'done', result: shortcutOutput });
  };
})();
