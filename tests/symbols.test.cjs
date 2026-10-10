'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createCanvas, Image: CanvasImage } = require('@napi-rs/canvas');
const symbols = require('../tools/symbols-server.cjs'), graphics = require('../tools/graphics-server.cjs');
const root = path.resolve(__dirname, '../app/src/main/assets');
function environment() {
  const warnings = [], sandbox = { postMessage() {}, setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array, crypto: require('node:crypto').webcrypto, btoa: v => Buffer.from(v, 'binary').toString('base64'), atob: v => Buffer.from(v, 'base64').toString('binary') };
  sandbox.self = sandbox; vm.createContext(sandbox); vm.runInContext(fs.readFileSync(path.join(root, 'runtime.js'), 'utf8'), sandbox);
  sandbox.__runtime = { context: { device: { locale: 'en-US' } }, register: map => Object.assign(sandbox, map), syncHost: (action, payload) => action.startsWith('symbols.') ? symbols.handle(action, payload) : graphics.handle(action, payload) };
  vm.runInContext(fs.readFileSync(path.join(root, 'runtime-graphics.js'), 'utf8'), sandbox); sandbox.console.warn = message => warnings.push(message);
  vm.runInContext(fs.readFileSync(path.join(root, 'runtime-symbols.js'), 'utf8'), sandbox);
  return { run: code => vm.runInContext(code, sandbox), warnings };
}
async function pixels(image) { const decoded = new CanvasImage(); decoded.src = Buffer.from(image.data.toBase64String(), 'base64'); await decoded.decode(); const canvas = createCanvas(decoded.width, decoded.height), ctx = canvas.getContext('2d'); ctx.drawImage(decoded, 0, 0); const values = ctx.getImageData(0, 0, decoded.width, decoded.height).data; return { values, filled: Array.from(values).filter((v, i) => i % 4 === 3 && v > 0).length }; }
test('every licensed SF identifier has a usable Symbol and original vectors remain preferred', () => {
  const { run } = environment(); const result = run(`var cat=self.__runtime.syncHost('symbols.catalog',{});var missing=cat.sf.filter(name=>!SFSymbol.named(name));[missing.length,SFSymbol.named('sun.max.fill').platformIcon,SFSymbol.named('totally.unknown.icon')];`);
  assert.equal(result[0], 0); assert.equal(result[1], 'original:sun.max.fill'); assert.equal(result[2], null);
  const coverage = JSON.parse(run(`JSON.stringify(SFSymbol.coverage())`)); assert.equal(coverage.names, 9155); assert.equal(coverage.androidIcons, 7448); assert.equal(coverage.original + coverage['literal-text'] + coverage['exact-name'] + coverage['semantic-alias'] + coverage.category + coverage['generic-fallback'], coverage.names); assert.ok(coverage.original > 150); assert.ok(coverage['semantic-alias'] > 100); console.log('Symbol coverage:', JSON.stringify(coverage));
});
test('semantic weather, battery, person and brain substitutions produce distinct nonempty PNG pixels', async () => {
  const { run } = environment(); const names = ['cloud.heavyrain.fill', 'person.3.fill', 'battery.100percent', 'brain.head.profile'];
  const images = names.map(name => run(`var symbol=SFSymbol.named(${JSON.stringify(name)});symbol.applyFont(Font.systemFont(96));symbol.image;`));
  for (const image of images) { assert.equal(image.size.width, 96); const p = await pixels(image); assert.ok(p.filled > 100); assert.ok(p.filled < 96 * 96); }
  assert.equal(new Set(images.map(image => image.data.toBase64String())).size, names.length);
  assert.equal(run(`SFSymbol.named('cloud.heavyrain.fill').platformIcon`), 'weather-pouring'); assert.equal(run(`SFSymbol.named('person.3.fill').platformIcon`), 'account-group');
});
test('known names without an equivalent expose labelled fallback and warn only once', () => {
  const { run, warnings } = environment(); const result = run(`var cat=self.__runtime.syncHost('symbols.catalog',{});var fallback=cat.sf.map(n=>SFSymbol.named(n)).find(s=>s.isFallback);var copy=SFSymbol.named(fallback.name);[fallback.name,fallback.platformIcon,fallback.isFallback,fallback.mappingConfidence,copy.image.size.width];`);
  assert.equal(result[1], 'help-circle-outline'); assert.equal(result[2], true); assert.equal(result[3], 'generic-fallback'); assert.equal(result[4], 24); assert.equal(warnings.length, 1); assert.match(warnings[0], /labelled.*fallback/);
});
test('all MDI glyphs are available directly; badge/wrapper/weight affect actual rendered pixels', async () => {
  const { run } = environment(); assert.equal(run(`var mdi=self.__runtime.syncHost('symbols.catalog',{}).mdi;Object.keys(mdi).filter(name=>!SFSymbol.android(name)).length`), 0);
  const plain = run(`var s=SFSymbol.android('weather-pouring');s.applyFont(Font.systemFont(100));s.image;`), bold = run(`s.applyBlackWeight();s.image;`), thin = run(`s.applyUltraLightWeight();s.image;`);
  assert.ok((await pixels(bold)).filled > (await pixels(plain)).filled); assert.ok((await pixels(thin)).filled < (await pixels(plain)).filled);
  const decorated = symbols.handle('symbols.render', { mdiName: 'account-group', size: 96, circle: true, badge: 'plus' }); assert.equal(decorated.width, 96); assert.ok(decorated.base64.length > 100);
  assert.throws(() => symbols.handle('symbols.render', { mdiName: 'not-present', size: 24 }), /Unknown/); assert.throws(() => symbols.handle('symbols.render', { mdiName: 'account', size: 4096 }), /1024/); assert.throws(() => symbols.handle('symbols.render', { mdiName: 'account', size: 24, badge: 'invalid' }), /badge/);
});
test('number and letter wrapper symbols render their actual literal with separate fill variants', async () => {
  const { run } = environment();
  const outline = run(`var n=SFSymbol.named('42.circle');n.applyFont(Font.systemFont(80));n.image;`), filled = run(`var n=SFSymbol.named('42.circle.fill');n.applyFont(Font.systemFont(80));n.image;`);
  assert.equal(run(`SFSymbol.named('42.circle').platformIcon`), 'text:42'); assert.equal(run(`SFSymbol.named('42.circle').isFallback`), false); assert.ok((await pixels(filled)).filled > (await pixels(outline)).filled); assert.notEqual(outline.data.toBase64String(), filled.data.toBase64String());
});
test('metadata and redistribution notices are bundled with the unchanged licensed font', () => {
  for (const name of ['mdi.ttf', 'mdi-map.json', 'sf-symbol-names.json', 'NOTICE.txt', 'MDI-LICENSE.txt', 'SF-NAMES-LICENSE.txt', 'APACHE-2.0.txt']) assert.ok(fs.statSync(path.join(root, 'icons', name)).size > 100);
  assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root, 'icons/mdi.ttf'))).digest('hex'), '61e8aba5a4e981fe22cf7c8e8bcdbea00476e75c62c37f01bf7ee33361d68428'); assert.match(fs.readFileSync(path.join(root, 'icons/NOTICE.txt'), 'utf8'), /No Apple font/);
});
