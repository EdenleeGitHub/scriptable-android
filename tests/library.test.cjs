'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assets = path.resolve(__dirname, '../app/src/main/assets');
const core = fs.readFileSync(path.join(assets, 'runtime.js'), 'utf8');
const library = fs.readFileSync(path.join(assets, 'runtime-library.js'), 'utf8');
const compat = fs.readFileSync(path.join(assets, 'runtime-compat.js'), 'utf8');
const main = { id: 'main', name: 'Main', code: '// current repository source', color: '#112233', icon: 'code', updatedAt: 10000 };
async function run(code, extra = {}, handler = () => true) {
  const operations = [], messages = []; let ending;
  const endPromise = new Promise(resolve => { ending = resolve; });
  const sandbox = { setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array, crypto: require('node:crypto').webcrypto,
    btoa: value => Buffer.from(value, 'binary').toString('base64'), atob: value => Buffer.from(value, 'base64').toString('binary'),
    postMessage(message) {
      message = structuredClone(message); messages.push(message);
      if (message.type === 'host') { operations.push(message); Promise.resolve().then(() => handler(message)).then(result => sandbox.onmessage({ data: { type: 'hostResult', id: message.id, ok: true, result } }), error => sandbox.onmessage({ data: { type: 'hostResult', id: message.id, ok: false, error: error.message } })); }
      if (message.type === 'done' || message.type === 'error') ending(message);
    }
  };
  sandbox.self = sandbox; const context = vm.createContext(sandbox);
  sandbox.importScripts = () => { vm.runInContext(compat, context); vm.runInContext(library, context); };
  vm.runInContext(core, context);
  sandbox.onmessage({ data: { type: 'run', code, context: { script: { id: 'main', name: 'Main' }, scripts: [main], device: { locale: 'en-US' }, ...extra } } });
  const timeout = setTimeout(() => ending({ type: 'error', message: 'Timed out' }), 2000); const end = await endPromise; clearTimeout(timeout);
  return { end, operations, logs: messages.filter(message => message.type === 'log').map(message => message.values) };
}
test('current and imported module filenames expose repository source through string/data/file listing', async () => {
  const helper = { id: 'helper', name: 'Helper', code: `module.exports={filename:module.filename,source:FileManager.local().readString(module.filename)};`, updatedAt: 20000 };
  const result = await run(`const f=FileManager.local();const h=importModule('Helper');console.log(f.readString(module.filename),Data.fromFile(module.filename).toRawString(),h.filename,h.source,f.listContents('/documents'),f.creationDate(module.filename).getTime());`, { scripts: [main, helper], files: { '/documents/Main.js': { type: 'file', text: 'stale physical copy' } } });
  assert.equal(result.end.type, 'done'); assert.deepEqual(result.logs, [[main.code, main.code, '/documents/Helper.js', helper.code, ['Helper.js', 'Main.js'], 10000]]); assert.equal(result.operations.length, 0);
});
test('self update persists file contents before updating the existing library ID', async () => {
  const result = await run(`FileManager.local().writeString(module.filename,'console.log(42)');console.log(FileManager.local().readString(module.filename),Script.name());`);
  assert.equal(result.end.type, 'done'); assert.deepEqual(result.operations.map(op => op.action), ['file.op', 'repo.save']);
  assert.deepEqual(result.operations[1].payload, { id: 'main', name: 'Main', code: 'console.log(42)', color: '#112233', icon: 'code' }); assert.deepEqual(result.logs, [['console.log(42)', 'Main']]);
});
test('binary source writes decode into the library while ordinary JS files remain ordinary modules', async () => {
  const result = await run(`const f=FileManager.local();f.write(module.filename,Data.fromString('// binary UTF-8 source 你好'));f.writeString('/documents/New.js','module.exports=8');console.log(importModule('New'));`);
  assert.equal(result.end.type, 'done'); assert.deepEqual(result.operations.map(op => op.action), ['file.op', 'repo.save', 'file.op']); assert.equal(result.operations[1].payload.code, '// binary UTF-8 source 你好'); assert.deepEqual(result.logs, [[8]]);
});
test('copy materializes a virtual source and creates an independent script record with its own ID', async () => {
  const result = await run(`const f=FileManager.local();f.copy(module.filename,'/documents/Copy.js');f.writeString('/documents/Copy.js','module.exports=21');console.log(f.readString(module.filename),importModule('Copy'));`);
  assert.equal(result.end.type, 'done'); assert.deepEqual(result.operations.map(op => op.action), ['file.op', 'file.op', 'repo.save', 'file.op', 'repo.save']);
  assert.equal(result.operations[0].payload.op, 'writeString'); assert.equal(result.operations[1].payload.op, 'copy');
  const copy = result.operations[2].payload; assert.notEqual(copy.id, 'main'); assert.equal(copy.name, 'Copy'); assert.equal(result.operations[4].payload.id, copy.id); assert.deepEqual(result.logs, [[main.code, 21]]);
});
test('rename retains identity, updates module resolution and leaves the running Script name unchanged', async () => {
  const helper = { id: 'helper', name: 'Helper', code: 'module.exports=33' };
  const result = await run(`const f=FileManager.local();f.move('/documents/Helper.js','/documents/Renamed.js');console.log(f.fileExists('/documents/Helper.js'),importModule('Renamed'),Script.name());`, { scripts: [main, helper] });
  assert.equal(result.end.type, 'done'); assert.deepEqual(result.operations.map(op => op.action), ['file.op', 'file.op', 'repo.save']); assert.equal(result.operations[2].payload.id, 'helper'); assert.equal(result.operations[2].payload.name, 'Renamed'); assert.deepEqual(result.logs, [[false, 33, 'Main']]);
});
test('remove deletes the script record after the native file removal settles', async () => {
  const result = await run(`const f=FileManager.local();f.remove(module.filename);console.log(f.fileExists(module.filename));try{importModule('Main')}catch(e){console.log(e.message)}`);
  assert.equal(result.end.type, 'done'); assert.deepEqual(result.operations.map(op => op.action), ['file.op', 'repo.delete']); assert.deepEqual(result.operations[1].payload, { id: 'main' }); assert.equal(result.logs[0][0], false); assert.match(result.logs[1][0], /Module not found/);
});
test('moving a script outside the script directory preserves its bytes as an ordinary file', async () => {
  const result = await run(`const f=FileManager.local();f.move(module.filename,'/cache/source.txt');console.log(f.readString('/cache/source.txt'));f.writeString('/cache/source.txt','ordinary');`);
  assert.equal(result.end.type, 'done'); assert.deepEqual(result.operations.map(op => op.action), ['file.op', 'file.op', 'repo.delete', 'file.op']); assert.deepEqual(result.logs, [[main.code]]);
});
test('a failed native write/materialization prevents every dependent repository change', async () => {
  for (const code of [`FileManager.local().writeString(module.filename,'modified');`, `FileManager.local().copy(module.filename,'/documents/Copy.js');`, `FileManager.local().move(module.filename,'/documents/Renamed.js');`, `FileManager.local().remove(module.filename);`]) {
    const result = await run(code, {}, () => { throw new Error('Native storage is full'); });
    assert.equal(result.end.type, 'error'); assert.match(result.end.message, /Native storage is full/); assert.equal(result.operations.length, 1); assert.equal(result.operations[0].action, 'file.op');
  }
});
test('unsafe script names never introduce paths outside valid script aliases', async () => {
  const result = await run(`console.log(FileManager.local().listContents('/documents'));`, { scripts: [main, { id: 'unsafe', name: '../outside', code: 'bad' }, { id: 'slash', name: 'a/b', code: 'bad' }, { id: 'nul', name: 'a\0b', code: 'bad' }] });
  assert.equal(result.end.type, 'done'); assert.deepEqual(result.logs, [[['Main.js']]]); assert.equal(result.operations.length, 0);
});
