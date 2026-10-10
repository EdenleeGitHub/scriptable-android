/* Android clipboard images, binary sharing and typed document previews. */
(() => {
  'use strict';
  const R = self.__runtime, { Data, Image, FileManager } = self;
  const observe = fn => function (...args) { return R.observe(Promise.resolve().then(() => fn.apply(this, args))); };
  const sniff = bytes => {
    const ascii = (start, length) => String.fromCharCode(...bytes.slice(start, start + length));
    if (bytes[0] === 137 && ascii(1, 3) === 'PNG') return { mimeType: 'image/png', extension: 'png' };
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mimeType: 'image/jpeg', extension: 'jpg' };
    if (/^GIF8[79]a$/.test(ascii(0, 6))) return { mimeType: 'image/gif', extension: 'gif' };
    if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return { mimeType: 'image/webp', extension: 'webp' };
    if (ascii(0, 5) === '%PDF-') return { mimeType: 'application/pdf', extension: 'pdf' };
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
      if (!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return { mimeType: 'text/plain', extension: 'txt', text };
    } catch (_) {}
    return { mimeType: 'application/octet-stream', extension: 'bin' };
  };
  const encoded = (data, name) => {
    if (!(data instanceof Data)) throw new TypeError('Expected Data.');
    const type = sniff(data.getBytes());
    return { base64: data.toBase64String(), mimeType: type.mimeType, name: name || 'Document.' + type.extension, _text: type.text };
  };
  const encodeImage = image => {
    if (!(image instanceof Image)) throw new TypeError('Expected Image.');
    const value = encoded(image.data, 'Image'); value.mimeType = image.mimeType || value.mimeType;
    value.name = 'Image.' + ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[value.mimeType] || 'png'); return value;
  };
  const decodeImage = value => {
    if (!value?.base64) return null;
    const image = new Image(Data.fromBase64String(value.base64), value.mimeType || 'image/png');
    if (value.width && value.height) image._imageSize = new self.Size(value.width, value.height); return image;
  };
  let copiedImage;
  self.Pasteboard.copyImage = image => { const value = encodeImage(image); copiedImage = value; R.context.clipboard = null; R.persist('clipboard.writeImage', value); };
  self.Pasteboard.pasteImage = () => decodeImage(copiedImage !== undefined ? copiedImage : R.syncHost('clipboard.readImage'));
  const copyString = self.Pasteboard.copyString;
  self.Pasteboard.copyString = function (...args) { const result = copyString.apply(this, args); copiedImage = null; return result; };
  const filePath = value => typeof value === 'string' && /^\/(documents|cache|temporary|library|cloud|bookmarks)\//.test(value);
  function item(value) {
    if (value instanceof Image) { const { _text, ...payload } = encodeImage(value); return { type: 'image', ...payload }; }
    if (value instanceof Data) { const { _text, ...payload } = encoded(value); return { type: 'data', ...payload }; }
    if (filePath(value)) {
      const manager = FileManager.local(), { _text, ...payload } = encoded(manager.read(value), manager.fileName(value, true));
      return { type: payload.mimeType.startsWith('image/') ? 'image' : 'data', ...payload };
    }
    return { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(R.clean(value), null, 2) };
  }
  self.ShareSheet.present = observe(values => {
    if (!Array.isArray(values) || !values.length || values.length > 20) throw new TypeError('ShareSheet.present expects between 1 and 20 items.');
    return R.host('sharing.present', { items: values.map(item) });
  });
  self.QuickLook.present = observe(async (value, fullscreen = true) => {
    let name;
    if (filePath(value)) { name = FileManager.local().fileName(value, true); value = FileManager.local().read(value); }
    if (value instanceof Image) { R.send({ type: 'preview', value: value.toJSON(), format: 'image', fullscreen: !!fullscreen }); return; }
    if (value instanceof Data) {
      const payload = encoded(value, name);
      if (payload.mimeType.startsWith('image/')) { R.send({ type: 'preview', value: `data:${payload.mimeType};base64,${payload.base64}`, format: 'image', fullscreen: !!fullscreen }); return; }
      if (payload._text !== undefined) { R.send({ type: 'preview', value: payload._text, format: 'text', fullscreen: !!fullscreen }); return; }
      const { _text, ...document } = payload; return R.host('document.preview', { ...document, fullscreen: !!fullscreen });
    }
    R.send({ type: 'preview', value: typeof value === 'string' ? value : JSON.stringify(R.clean(value), null, 2), format: 'text', fullscreen: !!fullscreen });
  });
})();
