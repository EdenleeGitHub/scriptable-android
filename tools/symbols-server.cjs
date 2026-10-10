'use strict';
const fs = require('node:fs'), path = require('node:path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const root = path.resolve(__dirname, '../app/src/main/assets/icons');
const mdi = JSON.parse(fs.readFileSync(path.join(root, 'mdi-map.json'), 'utf8')), sf = JSON.parse(fs.readFileSync(path.join(root, 'sf-symbol-names.json'), 'utf8'));
GlobalFonts.registerFromPath(path.join(root, 'mdi.ttf'), 'Scriptable Material Design Icons');
function handle(action, payload = {}) {
  if (action === 'symbols.catalog') return { mdi, sf, mdiVersion: '7.4.47', sfNamesVersion: '2.2.0' };
  if (action !== 'symbols.render') throw new Error('Unknown symbol action.');
  if (!Object.hasOwn(mdi, payload.mdiName)) throw new Error('Unknown Android icon: ' + payload.mdiName);
  const requested = Number(payload.size ?? 24); if (!Number.isFinite(requested) || requested <= 0 || requested > 1024) throw new Error('Symbol size must be between 0 and 1024.');
  const size = Math.max(1, Math.ceil(requested)), canvas = createCanvas(size, size), ctx = canvas.getContext('2d'), wrapped = payload.circle || payload.square;
  const literal = payload.textValue || ''; if (literal && !/^(?:[0-9]{1,2}|[a-z])$/.test(literal)) throw new Error('Invalid literal symbol.');
  const glyph = literal || String.fromCodePoint(mdi[payload.mdiName]), shapeFilled = wrapped && payload.shapeFilled;
  let weight = payload.weight === 'bold' ? 700 : payload.weight === 'normal' ? 400 : Number(payload.weight || 400); if (!Number.isFinite(weight)) weight = 400; weight = Math.max(100, Math.min(900, weight));
  const badge = payload.badge || ''; if (!['', 'dot', 'plus', 'minus', 'checkmark', 'xmark', 'exclamationmark', 'questionmark'].includes(badge)) throw new Error('Invalid symbol badge.');
  ctx.font = `${size * (literal ? .49 : wrapped ? .68 : .94)}px ${literal ? 'sans-serif' : '"Scriptable Material Design Icons"'}`;
  ctx.fillStyle = '#000';
  if (shapeFilled) { ctx.beginPath(); if (payload.circle) ctx.arc(size / 2, size / 2, size * .44, 0, 2 * Math.PI); else ctx.roundRect(size * .06, size * .06, size * .88, size * .88, size * .14); ctx.fill(); ctx.fillStyle = '#fff'; }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const metrics = ctx.measureText(glyph), width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight, height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  const x = (size - width) / 2 + metrics.actualBoundingBoxLeft, y = (size - height) / 2 + metrics.actualBoundingBoxAscent;
  ctx.fillText(glyph, x, y);
  if (weight !== 400) { ctx.lineWidth = size * Math.abs(weight - 400) / 400 * .012; ctx.lineJoin = 'round'; ctx.strokeStyle = shapeFilled && weight > 400 ? '#fff' : '#000'; if (weight < 400 && !shapeFilled) ctx.globalCompositeOperation = 'destination-out'; ctx.strokeText(glyph, x, y); ctx.globalCompositeOperation = 'source-over'; }
  ctx.lineWidth = Math.max(.5, size * .065); ctx.strokeStyle = '#000';
  if (payload.circle) { ctx.beginPath(); ctx.arc(size / 2, size / 2, size * .44, 0, 2 * Math.PI); ctx.stroke(); }
  else if (payload.square) { ctx.beginPath(); ctx.roundRect(size * .06, size * .06, size * .88, size * .88, size * .14); ctx.stroke(); }
  if (badge) {
    const cx = size * .78, cy = size * .78, r = size * .21, d = r * .5;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, r + size * .025, 0, 2 * Math.PI); ctx.fill(); ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = Math.max(.5, size * .045); ctx.lineCap = 'round';
    if (badge === 'plus' || badge === 'minus') { ctx.beginPath(); ctx.moveTo(cx - d, cy); ctx.lineTo(cx + d, cy); if (badge === 'plus') { ctx.moveTo(cx, cy - d); ctx.lineTo(cx, cy + d); } ctx.stroke(); }
    else if (badge === 'xmark' || badge === 'checkmark') { ctx.beginPath(); if (badge === 'xmark') { ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d); ctx.moveTo(cx - d, cy + d); ctx.lineTo(cx + d, cy - d); } else { ctx.moveTo(cx - d, cy); ctx.lineTo(cx - d / 4, cy + d / 2); ctx.lineTo(cx + d, cy - d / 2); } ctx.stroke(); }
    else if (badge !== 'dot') { ctx.font = `${r * 1.6}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText(badge === 'questionmark' ? '?' : '!', cx, cy + r * .55); }
  }
  const png = canvas.toBuffer('image/png'); if (png.length > 8 * 1024 * 1024) throw new Error('Rendered icon exceeds 8 MiB.'); return { base64: png.toString('base64'), mimeType: 'image/png', width: size, height: size };
}
module.exports = { handle };
