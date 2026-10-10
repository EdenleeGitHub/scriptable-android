'use strict';
// Desktop preview counterpart of Android's bounded Canvas renderer.
const { createCanvas, Image, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('node:fs');
const MAX_SIDE = 2048, MAX_PIXELS = 4 * 1024 * 1024, MAX_BYTES = 8 * 1024 * 1024, MAX_COMMANDS = 10000;
for (const [file, name] of [['C:/Windows/Fonts/msyh.ttc', 'Microsoft YaHei'], ['C:/Windows/Fonts/simsun.ttc', 'SimSun']]) if (fs.existsSync(file)) { try { GlobalFonts.registerFromPath(file, name); } catch (_) {} }
function dimensions(width, height) { if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) throw new Error('Images must be 1-2048 pixels per dimension and at most 4 megapixels.'); }
function n(value, fallback = 0) { const number = Number(value ?? fallback); if (!Number.isFinite(number) || Math.abs(number) > 1000000) throw new Error('Invalid drawing number.'); return number; }
function imageBytes(base64) { if (typeof base64 !== 'string' || base64.length > Math.ceil(MAX_BYTES * 4 / 3) + 16 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64.replace(/\s/g, ''))) throw new Error('Invalid or oversized image base64.'); const bytes = Buffer.from(base64, 'base64'); if (bytes.length > MAX_BYTES) throw new Error('Image exceeds 8 MiB.'); return bytes; }
function metadata(bytes) {
  let width, height, mimeType;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); mimeType = 'image/png'; }
  else if (bytes.length >= 10 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) { width = bytes.readUInt16LE(6); height = bytes.readUInt16LE(8); mimeType = 'image/gif'; }
  else if (bytes.length >= 26 && bytes.toString('ascii', 0, 2) === 'BM') { width = Math.abs(bytes.readInt32LE(18)); height = Math.abs(bytes.readInt32LE(22)); mimeType = 'image/bmp'; }
  else if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    mimeType = 'image/webp'; const format = bytes.toString('ascii', 12, 16);
    if (format === 'VP8X') { width = bytes.readUIntLE(24, 3) + 1; height = bytes.readUIntLE(27, 3) + 1; }
    else if (format === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) { width = bytes.readUInt16LE(26) & 16383; height = bytes.readUInt16LE(28) & 16383; }
    else if (format === 'VP8L' && bytes[20] === 47) { const bits = bytes.readUInt32LE(21); width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1; }
  }
  else if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216) {
    mimeType = 'image/jpeg'; let p = 2;
    while (p + 4 < bytes.length) { if (bytes[p++] !== 255) continue; while (bytes[p] === 255) p++; const marker = bytes[p++]; if (marker === 0 || marker === 216 || marker === 1 || marker >= 208 && marker <= 215) continue; if (marker === 217 || marker === 218) break; if (p + 2 > bytes.length) break; const length = bytes.readUInt16BE(p); if (length < 2 || p + length > bytes.length) break; if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) { height = bytes.readUInt16BE(p + 3); width = bytes.readUInt16BE(p + 5); break; } p += length; }
  }
  dimensions(width, height); return { width, height, mimeType };
}
async function decode(base64) { const bytes = imageBytes(base64), info = metadata(bytes), image = new Image(); image.src = bytes; await image.decode(); dimensions(image.width, image.height); if (image.width !== info.width || image.height !== info.height) throw new Error('Image dimensions disagree with encoded header.'); return { image, info }; }
function encode(canvas, jpeg = false, quality = .9) { const bytes = canvas.toBuffer(jpeg ? 'image/jpeg' : 'image/png', jpeg ? quality : undefined); if (bytes.length > MAX_BYTES) throw new Error('Encoded image exceeds 8 MiB.'); return { base64: bytes.toString('base64'), mimeType: jpeg ? 'image/jpeg' : 'image/png', width: canvas.width, height: canvas.height }; }
function path(context, segments) {
  if (!Array.isArray(segments) || segments.length > MAX_COMMANDS) throw new Error('Path exceeds 10000 segments.'); context.beginPath();
  for (const s of segments) {
    const x = n(s.x), y = n(s.y), w = n(s.width), h = n(s.height);
    switch (s.op) {
      case 'move': context.moveTo(x, y); break; case 'line': context.lineTo(x, y); break;
      case 'curve': context.bezierCurveTo(n(s.c1?.x), n(s.c1?.y), n(s.c2?.x), n(s.c2?.y), x, y); break;
      case 'quad': context.quadraticCurveTo(n(s.c?.x), n(s.c?.y), x, y); break;
      case 'rect': context.moveTo(x, y + h); context.lineTo(x + w, y + h); context.lineTo(x + w, y); context.lineTo(x, y); context.closePath(); break;
      case 'ellipse': if (w > 0 && h > 0) { context.moveTo(x + w, y + h / 2); context.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2, true); context.closePath(); } break;
      case 'roundRect': {
        if (w <= 0 || h <= 0) break;
        const rx = Math.max(0, Math.min(n(s.rx), w / 2)), ry = Math.max(0, Math.min(n(s.ry), h / 2)), k = .5522847498307936;
        context.moveTo(x + rx, y); context.bezierCurveTo(x + rx - rx * k, y, x, y + ry - ry * k, x, y + ry); context.lineTo(x, y + h - ry); context.bezierCurveTo(x, y + h - ry + ry * k, x + rx - rx * k, y + h, x + rx, y + h); context.lineTo(x + w - rx, y + h); context.bezierCurveTo(x + w - rx + rx * k, y + h, x + w, y + h - ry + ry * k, x + w, y + h - ry); context.lineTo(x + w, y + ry); context.bezierCurveTo(x + w, y + ry - ry * k, x + w - rx + rx * k, y, x + w - rx, y); context.closePath(); break;
      }
      case 'close': context.closePath(); break; default: throw new Error('Invalid path operation.');
    }
  }
}
function rectangle(r) { return [n(r.x), n(r.y), n(r.width), n(r.height)]; }
function drawText(context, c) {
  const text = String(c.text ?? ''); if (text.length > 32768) throw new Error('Drawn text exceeds 32768 characters.');
  const f = c.font || {}, size = n(f.size); if (size <= 0 || size > 1024) throw new Error('Invalid font size.');
  const family = String(f.family || 'sans-serif').replace(/["\\\r\n]/g, '');
  context.font = `${f.style === 'italic' ? 'italic' : 'normal'} ${/^(?:[1-9]00|bold|normal)$/.test(String(f.weight)) ? f.weight : 'normal'} ${size}px "${family}", "Microsoft YaHei", sans-serif`;
  context.textBaseline = 'top';
  const r = c.rect || c.point || {}, x = n(r.x), y = n(r.y), bounded = !!c.rect, width = bounded ? n(r.width) : Math.max(1, ...text.split('\n').map(line => context.measureText(line).width)), height = bounded ? n(r.height) : 1000000;
  if (width <= 0 || height <= 0) return;
  const lines = [];
  for (const paragraph of text.split('\n')) {
    if (!bounded || !paragraph) { lines.push(paragraph); continue; }
    let line = '';
    // Grapheme segmentation preserves emoji and accents and permits CJK wrap.
    const chars = typeof Intl.Segmenter === 'function' ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(paragraph), item => item.segment) : Array.from(paragraph);
    for (const char of chars) { if (line && context.measureText(line + char).width > width) { lines.push(line); line = char; } else line += char; } lines.push(line);
  }
  context.save(); if (bounded) { context.beginPath(); context.rect(x, y, width, height); context.clip(); }
  context.textAlign = ['left', 'center', 'right'].includes(c.alignment) ? c.alignment : 'left'; const tx = x + (context.textAlign === 'center' ? width / 2 : context.textAlign === 'right' ? width : 0), lineHeight = size * 1.2;
  for (let i = 0; i < lines.length && i * lineHeight < height; i++) context.fillText(lines[i], tx, y + i * lineHeight); context.restore();
}
function render(payload, images = new Map()) {
  if (JSON.stringify(payload).length > 12 * 1024 * 1024) throw new Error('Drawing recipe exceeds 12 MiB.');
  const width = n(payload.width), height = n(payload.height), scale = n(payload.scale, 1);
  if (width <= 0 || height <= 0 || scale <= 0 || scale > 256) throw new Error('Drawing size and scale must be positive.'); const w = Math.ceil(width * scale), h = Math.ceil(height * scale); dimensions(w, h);
  if (!Array.isArray(payload.commands) || payload.commands.length > MAX_COMMANDS) throw new Error('Drawing exceeds 10000 operations.');
  const canvas = createCanvas(w, h), ctx = canvas.getContext('2d'); if (payload.opaque !== false) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); } ctx.scale(scale, scale); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const c of payload.commands) {
    const color = c.color || '#000000ff'; if (!/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color)) throw new Error('Invalid drawing color.'); ctx.fillStyle = color; ctx.strokeStyle = color; const lineWidth = n(c.lineWidth, 1); if (lineWidth < 0 || lineWidth > 1024) throw new Error('Invalid line width.'); ctx.lineWidth = lineWidth || 0.00001;
    ctx.save(); if (c.transform) { const t = c.transform, s = n(t.scale, 1); if (s <= 0 || s > 256) throw new Error('Invalid drawing transform.'); ctx.translate(n(t.x), n(t.y)); ctx.scale(s, s); }
    switch (c.op) {
      case 'fillRect': ctx.fillRect(...rectangle(c.rect)); break; case 'strokeRect': ctx.strokeRect(...rectangle(c.rect)); break;
      case 'fillEllipse': case 'strokeEllipse': { const [x, y, w, h] = rectangle(c.rect); if (w > 0 && h > 0) { ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); c.op === 'fillEllipse' ? ctx.fill() : ctx.stroke(); } break; }
      case 'fillPath': case 'strokePath': path(ctx, c.path); c.op === 'fillPath' ? ctx.fill() : ctx.stroke(); break;
      case 'text': drawText(ctx, c); break;
      case 'image': { const decoded = images.get(c.base64); if (!decoded) throw new Error('Image decoding has not completed.'); ctx.drawImage(decoded.image, ...rectangle(c.rect)); break; }
      default: throw new Error(`Invalid drawing operation: ${c.op}`);
    } ctx.restore();
  }
  return encode(canvas);
}
function handle(action, payload = {}) {
  switch (action) {
    case 'graphics.render': {
      if (!Array.isArray(payload.commands)) return render(payload);
      if (payload.commands.length > MAX_COMMANDS) throw new Error('Drawing exceeds 10000 operations.');
      if (JSON.stringify(payload).length > 12 * 1024 * 1024) throw new Error('Drawing recipe exceeds 12 MiB.');
      const scale = n(payload.scale, 1); if (scale <= 0 || scale > 256) throw new Error('Invalid drawing scale.'); dimensions(Math.ceil(n(payload.width) * scale), Math.ceil(n(payload.height) * scale));
      const sources = Array.from(new Set(payload.commands.filter(c => c.op === 'image').map(c => c.base64)));
      // Decode images before painting; Image.src alone can look complete while
      // its pixels are still unavailable. Sync XHR waits for this response.
      if (!sources.length) return render(payload);
      return (async () => { const images = new Map(); let pixels = 0; for (const source of sources) { const info = metadata(imageBytes(source)); pixels += info.width * info.height; if (pixels > MAX_PIXELS * 4) throw new Error('Composition source images exceed 16 megapixels in total.'); images.set(source, await decode(source)); } return render(payload, images); })();
    }
    case 'graphics.symbol': if (!payload.commands) throw new Error(`Unknown Android symbol recipe: ${payload.name}`); return render({ ...payload, width: 24, height: 24, scale: n(payload.fontSize, 24) / 24, opaque: false });
    case 'image.info': return decode(payload.base64).then(decoded => decoded.info);
    case 'image.convert': return decode(payload.base64).then(({ image }) => { const canvas = createCanvas(image.width, image.height), ctx = canvas.getContext('2d'), jpeg = payload.format === 'jpeg', quality = n(payload.quality, .9); if (quality < 0 || quality > 1) throw new Error('Image quality must be between 0 and 1.'); if (jpeg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); } ctx.drawImage(image, 0, 0); return encode(canvas, jpeg, quality); });
    default: throw new Error(`Unsupported graphics action: ${action}`);
  }
}
module.exports = { handle };
