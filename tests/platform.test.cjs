'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assets = path.resolve(__dirname, '../app/src/main/assets');
const core = fs.readFileSync(path.join(assets, 'runtime.js'), 'utf8');
const extension = fs.readFileSync(path.join(assets, 'runtime-platform.js'), 'utf8');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+XGkAAAAASUVORK5CYII=';
async function run(code, handler = () => true, extra = {}, sync = () => null) {
  const messages = [], operations = []; let resolveEnd;
  const ending = new Promise(resolve => { resolveEnd = resolve; });
  const sandbox = { setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array, crypto: require('node:crypto').webcrypto,
    btoa: value => Buffer.from(value, 'binary').toString('base64'), atob: value => Buffer.from(value, 'base64').toString('binary'),
    postMessage(message) {
      message = structuredClone(message); messages.push(message);
      if (message.type === 'host') { operations.push(message); Promise.resolve().then(() => handler(message)).then(result => sandbox.onmessage({ data: { type: 'hostResult', id: message.id, ok: true, result } }), error => sandbox.onmessage({ data: { type: 'hostResult', id: message.id, ok: false, error: error.message } })); }
      if (message.type === 'done' || message.type === 'error') resolveEnd(message);
    }
  };
  sandbox.self = sandbox; const context = vm.createContext(sandbox);
  sandbox.importScripts = () => { sandbox.__runtime.syncHost = sync; vm.runInContext(extension, context); };
  vm.runInContext(core, context); sandbox.onmessage({ data: { type: 'run', code, context: { script: { id: 'test', name: 'Test' }, device: {}, ...extra } } });
  const timeout = setTimeout(() => resolveEnd({ type: 'error', message: 'Harness timed out' }), 2000); const end = await ending; clearTimeout(timeout);
  return { end, operations, previews: messages.filter(message => message.type === 'preview'), logs: messages.filter(message => message.type === 'log').map(message => message.values) };
}
test('clipboard image copy persists real bytes while same-run paste is immediately consistent', async () => {
  const result = await run(`const image=new Image(Data.fromBase64String('${png}'),'image/png');Pasteboard.copyImage(image);console.log(Pasteboard.pasteImage() instanceof Image,Pasteboard.pasteImage().data.toBase64String(),Pasteboard.pasteString());Pasteboard.copyString('text');console.log(Pasteboard.pasteImage());`, message => {
    if (message.action === 'clipboard.writeImage') { assert.equal(message.payload.base64, png); assert.equal(message.payload.mimeType, 'image/png'); } else assert.equal(message.action, 'clipboard.write'); return true;
  }, { clipboard: 'old text' }, () => { throw new Error('Same-run clipboard read must use the pending copy'); });
  assert.equal(result.end.type, 'done'); assert.deepEqual(result.logs, [[true, png, null], [null]]); assert.deepEqual(result.operations.map(op => op.action), ['clipboard.writeImage', 'clipboard.write']);
});
test('reading a system clipboard image returns actual Image data or null for a text clipboard', async () => {
  for (const reply of [null, { base64: png, mimeType: 'image/png', width: 1, height: 1 }]) {
    const result = await run(`const image=Pasteboard.pasteImage();console.log(image?image.data.toBase64String():null);`, () => true, {}, action => { assert.equal(action, 'clipboard.readImage'); return reply; });
    assert.equal(result.end.type, 'done'); assert.deepEqual(result.logs, [[reply ? png : null]]);
  }
});
test('clipboard permission and size failures surface even for synchronous unawaited copy', async () => {
  const result = await run(`Pasteboard.copyImage(new Image(Data.fromBase64String('${png}'),'image/png'));`, () => { throw new Error('Clipboard requires the foreground Android app'); });
  assert.equal(result.end.type, 'error'); assert.match(result.end.message, /foreground Android/);
});
test('mixed text/image/data/path sharing retains binary bytes, filenames and MIME types', async () => {
  const result = await run(`const image=new Image(Data.fromBase64String('${png}'),'image/png');const value=await ShareSheet.present(['Hello',image,Data.fromString('你好'),'/documents/report.pdf']);console.log(value.status,value.sent);`, message => {
    assert.equal(message.action, 'sharing.present'); const items = message.payload.items; assert.equal(items[0].text, 'Hello'); assert.equal(items[1].type, 'image'); assert.equal(items[1].base64, png); assert.equal(items[1].mimeType, 'image/png'); assert.equal(items[2].type, 'data'); assert.equal(Buffer.from(items[2].base64, 'base64').toString(), '你好'); assert.equal(items[3].name, 'report.pdf'); assert.equal(items[3].mimeType, 'application/pdf'); return { status: 'shareChooserOpened', sent: null };
  }, { files: { '/documents/report.pdf': { type: 'file', text: '%PDF-1.7\nexample' } } });
  assert.equal(result.end.type, 'done'); assert.deepEqual(result.logs, [['shareChooserOpened', null]]);
});
test('sharing native failures are awaited by the final drain and remain catchable', async () => {
  const failure = () => { throw new Error('No app can receive this attachment'); };
  const rejected = await run(`ShareSheet.present([Data.fromString('file')]);`, failure); assert.equal(rejected.end.type, 'error'); assert.match(rejected.end.message, /No app/);
  const caught = await run(`try{await ShareSheet.present([Data.fromString('file')])}catch(e){console.log(e.message)}`, failure); assert.equal(caught.end.type, 'done'); assert.deepEqual(caught.logs, [['No app can receive this attachment']]);
});
test('QuickLook distinguishes images, UTF8 text, PDFs and other binary data without corrupting bytes', async () => {
  const result = await run(`await QuickLook.present(Data.fromBase64String('${png}'),false);await QuickLook.present(Data.fromString('你好\\nJSON text'));await QuickLook.present(Data.fromString('%PDF-1.7\\nexample'));await QuickLook.present(new Data([0,255,1,2]));`, message => {
    assert.equal(message.action, 'document.preview'); if (message.payload.mimeType === 'application/pdf') assert.equal(Buffer.from(message.payload.base64, 'base64').toString(), '%PDF-1.7\nexample'); else assert.deepEqual([...Buffer.from(message.payload.base64, 'base64')], [0, 255, 1, 2]); return { status: 'externalViewerOpened' };
  });
  assert.equal(result.end.type, 'done'); assert.equal(result.previews.length, 2); assert.equal(result.previews[0].format, 'image'); assert.equal(result.previews[0].value, 'data:image/png;base64,' + png); assert.equal(result.previews[0].fullscreen, false); assert.equal(result.previews[1].value, '你好\nJSON text'); assert.deepEqual(result.operations.map(op => op.payload.mimeType), ['application/pdf', 'application/octet-stream']);
});
test('QuickLook file paths read real file content and retain the exported document name', async () => {
  const result = await run(`await QuickLook.present('/documents/report.pdf');await QuickLook.present('ordinary text');await QuickLook.present({answer:42});`, message => { assert.equal(message.payload.name, 'report.pdf'); return { status: 'externalViewerOpened' }; }, { files: { '/documents/report.pdf': { type: 'file', text: '%PDF-1.7\nreport' } } });
  assert.equal(result.end.type, 'done'); assert.equal(result.previews[0].value, 'ordinary text'); assert.match(result.previews[1].value, /"answer": 42/);
});
test('missing QuickLook paths and external document viewer errors are explicit and catchable', async () => {
  const result = await run(`try{await QuickLook.present('/documents/missing.pdf')}catch(e){console.log('missing')}try{await QuickLook.present(Data.fromString('%PDF-1.7'))}catch(e){console.log(e.message)}`, () => { throw new Error('Install a PDF viewer'); });
  assert.equal(result.end.type, 'done'); assert.deepEqual(result.logs, [['missing'], ['Install a PDF viewer']]);
});
