'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const runtimePath = path.resolve(__dirname, '../app/src/main/assets/runtime.js');
const source = fs.readFileSync(runtimePath, 'utf8');

function makeSandbox(postMessage) {
  const sandbox = { postMessage, setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array, console,
    btoa: value => Buffer.from(value, 'binary').toString('base64'), atob: value => Buffer.from(value, 'base64').toString('binary'), crypto: require('node:crypto').webcrypto };
  sandbox.self = sandbox;
  return sandbox;
}

if (!isMainThread && workerData?.runtimeHarness) {
  const sandbox = makeSandbox(message => parentPort.postMessage(message));
  vm.runInNewContext(source, sandbox, { filename: runtimePath });
  parentPort.on('message', message => sandbox.onmessage({ data: message }));
} else {
  async function run(code, extraContext = {}, hostHandler = () => null) {
    const messages = [], operations = [];
    let resolveEnd;
    const ending = new Promise(resolve => { resolveEnd = resolve; });
    const sandbox = makeSandbox(message => {
      // Capture what an actual Worker structured clone would send.
      message = structuredClone(message); messages.push(message);
      if (message.type === 'host') {
        operations.push(message);
        Promise.resolve().then(() => hostHandler(message)).then(result => sandbox.onmessage({ data: { type: 'hostResult', id: message.id, ok: true, result } }), error => sandbox.onmessage({ data: { type: 'hostResult', id: message.id, ok: false, error: error.message } }));
      }
      if (message.type === 'done' || message.type === 'error') resolveEnd(message);
    });
    vm.runInNewContext(source, sandbox, { filename: runtimePath });
    sandbox.onmessage({ data: { type: 'run', code, context: { script: { id: 'test', name: 'Test' }, device: { name: 'Pixel', systemName: 'Android', screenSize: { width: 412, height: 915 }, screenScale: 2.6, locale: 'en-US', batteryLevel: 0.75 }, ...extraContext } } });
    const timeout = setTimeout(() => resolveEnd({ type: 'error', message: 'Harness timed out' }), 2000);
    const end = await ending; clearTimeout(timeout);
    return { end, messages, operations };
  }

  test('top-level await Request returns JSON and response metadata through native bridge', async () => {
    const result = await run(`const r = new Request('https://example.com/data'); r.headers = {'X-Test':'yes'}; const data = await r.loadJSON(); console.log(data.value, r.response.statusCode, Script.name()); Script.setShortcutOutput(data);`, {}, message => {
      assert.equal(message.action, 'request'); assert.equal(message.payload.encoding, 'text'); assert.equal(message.payload.headers['X-Test'], 'yes');
      return { body: '{"value":42}', statusCode: 201, headers: {}, url: 'https://example.com/data', mimeType: 'application/json' };
    });
    assert.equal(result.end.type, 'done'); assert.deepEqual(result.end.result, { value: 42 });
    assert.deepEqual(result.messages.find(message => message.type === 'log').values, [42, 201, 'Test']);
  });

  test('file changes are immediately visible and all persistence is ordered before done', async () => {
    const persisted = [];
    const result = await run(`const f = FileManager.local(); const dir = f.joinPath(f.documentsDirectory(), 'notes'); f.createDirectory(dir); f.writeString(dir+'/a.txt','你好'); f.copy(dir+'/a.txt',dir+'/b.txt'); f.move(dir+'/b.txt',dir+'/c.txt'); console.log(f.readString(dir+'/c.txt'),f.listContents(dir)); f.remove(dir+'/a.txt');`, {}, async message => {
      await new Promise(resolve => setTimeout(resolve, 8)); persisted.push(message.payload.op);
    });
    assert.equal(result.end.type, 'done');
    assert.deepEqual(persisted, ['createDirectory', 'writeString', 'copy', 'move', 'remove']);
    assert.deepEqual(result.messages.find(message => message.type === 'log').values, ['你好', ['a.txt', 'c.txt']]);
    assert.equal(result.messages.at(-1).type, 'done');
  });

  test('unawaited persistence failure surfaces and stops dependent writes', async () => {
    const result = await run(`const f = FileManager.local(); f.writeString('/documents/a','one'); f.writeString('/documents/b','two'); Script.complete();`, {}, () => { throw new Error('Disk is full'); });
    assert.equal(result.end.type, 'error'); assert.match(result.end.message, /Disk is full/); assert.equal(result.operations.length, 1);
  });

  test('unawaited native actions settle before done and native failures surface', async () => {
    for (const code of [`const n=new Notification(); n.title='Test'; n.schedule();`, `const a=new Alert(); a.addAction('OK'); a.presentAlert();`, `Safari.open('https://example.com');`]) {
      let replied = false;
      const result = await run(code, {}, async () => { await new Promise(resolve => setTimeout(resolve, 10)); replied = true; return { index: 0, values: [] }; });
      assert.equal(result.end.type, 'done'); assert.equal(replied, true);
      for (const delay of [0, 10]) {
        const failed = await run(code, {}, async () => { if (delay) await new Promise(resolve => setTimeout(resolve, delay)); throw new Error('Native action rejected'); });
        assert.equal(failed.end.type, 'error'); assert.match(failed.end.message, /Native action rejected/);
      }
    }
  });

  test('awaited native failures can be caught for a deliberate successful fallback', async () => {
    const result = await run(`try { await new Request('https://example.com').loadJSON(); } catch (error) { console.log('fallback',error.message); }`, {}, () => { throw new Error('Offline'); });
    assert.equal(result.end.type, 'done'); assert.deepEqual(result.messages.find(message => message.type === 'log').values, ['fallback', 'Offline']);
  });

  test('alerts return chosen actions and edited secure/text field values', async () => {
    const result = await run(`const a = new Alert(); a.title='Input'; a.addAction('Save'); a.addCancelAction('Cancel'); a.addTextField('Name','old'); a.addSecureTextField('Secret',''); const i=await a.present(); console.log(i,a.textFieldValue(0),a.textFieldValue(1));`, {}, message => {
      assert.equal(message.action, 'alert'); assert.equal(message.payload.cancel, 'Cancel'); assert.equal(message.payload.textFields[1].secure, true); return { index: 0, values: ['new', 'secret'] };
    });
    assert.equal(result.end.type, 'done'); assert.deepEqual(result.messages.find(message => message.type === 'log').values, [0, 'new', 'secret']);
  });

  test('importModule caches CommonJS exports and supports module scripts using runtime APIs', async () => {
    const result = await run(`const a=importModule('Helper'), b=importModule('Helper.js'); console.log(a===b,a.name(),a.count);`, { scripts: [{ id: 'helper', name: 'Helper', code: `console.log('module load'); module.exports={name:()=>Device.name(),count:1};` }] });
    assert.equal(result.end.type, 'done'); const logs = result.messages.filter(message => message.type === 'log'); assert.equal(logs.length, 2); assert.deepEqual(logs[1].values, [true, 'Pixel', 1]);
  });

  test('widgets serialize nested layout and persist Android home widget', async () => {
    let saved;
    const result = await run(`const w=new ListWidget(); w.backgroundColor=new Color('#123456'); w.setPadding(1,2,3,4); const row=w.addStack(); row.layoutHorizontally(); const t=row.addText('Hello'); t.textColor=Color.white(); t.font=Font.boldSystemFont(24); row.addSpacer(8); await w.presentMedium(); Script.setWidget(w); Script.complete();`, {}, message => { saved = message.payload; });
    assert.equal(result.end.type, 'done'); assert.equal(saved.scriptId, 'test'); assert.equal(saved.tree.backgroundColor, '#123456'); assert.deepEqual(saved.tree.padding, [1, 2, 3, 4]); assert.equal(saved.tree.children[0].children[0].font.weight, 'bold'); assert.equal(saved.tree.children[0].children[0].color, '#FFFFFF');
    assert.equal(result.messages.filter(message => message.type === 'widget').length, 2);
  });

  test('Unicode data, binary HTTP response and binary file writes retain bytes', async () => {
    const result = await run(`const text=Data.fromString('你好 🧪'); const copy=Data.fromBase64String(text.toBase64String()); const req=new Request('https://example.com/file'); const bytes=await req.load(); FileManager.local().write('/documents/binary',bytes); console.log(copy.toRawString(),bytes.getBytes());`, {}, message => message.action === 'request' ? { body: 'AAH/', statusCode: 200, headers: {}, mimeType: 'application/octet-stream' } : null);
    assert.equal(result.end.type, 'done'); assert.deepEqual(result.messages.find(message => message.type === 'log').values, ['你好 🧪', [0, 1, 255]]); assert.equal(result.operations[1].payload.base64, 'AAH/');
  });

  test('keychain and clipboard snapshot methods remain synchronous and persisted', async () => {
    const result = await run(`console.log(Pasteboard.pasteString()); Pasteboard.copy('changed'); Keychain.set('token','value'); console.log(Pasteboard.paste(),Keychain.get('token'),Keychain.contains('token')); Keychain.remove('token');`, { clipboard: 'initial', keychain: {} });
    assert.equal(result.end.type, 'done'); assert.deepEqual(result.messages.filter(message => message.type === 'log').map(message => message.values), [['initial'], ['changed', 'value', true]]); assert.deepEqual(result.operations.map(message => message.action), ['clipboard.write', 'keychain.op', 'keychain.op']);
  });

  test('keychain treats prototype property names as ordinary persisted keys', async () => {
    const snapshot = JSON.parse('{"__proto__":"saved prototype value","constructor":"saved constructor value"}');
    const result = await run(`console.log(Keychain.get('__proto__'),Keychain.get('constructor')); Keychain.set('__proto__','updated prototype'); Keychain.set('constructor','updated constructor'); console.log(Keychain.contains('__proto__'),Keychain.get('__proto__'),Keychain.get('constructor')); Keychain.remove('__proto__'); Keychain.remove('constructor'); console.log(Keychain.contains('__proto__'),Keychain.contains('constructor'));`, { keychain: snapshot });
    assert.equal(result.end.type, 'done');
    assert.deepEqual(result.messages.filter(message => message.type === 'log').map(message => message.values), [['saved prototype value', 'saved constructor value'], [true, 'updated prototype', 'updated constructor'], [false, false]]);
    assert.deepEqual(result.operations.map(message => [message.payload.op, message.payload.key]), [['set', '__proto__'], ['set', 'constructor'], ['remove', '__proto__'], ['remove', 'constructor']]);
  });

  test('request response reports native-decoded text encoding metadata', async () => {
    const result = await run(`const r=new Request('https://example.com'); console.log(await r.loadString(),r.response.textEncodingName);`, {}, () => ({ body: '中文', statusCode: 200, headers: {}, mimeType: 'text/plain', textEncodingName: 'GBK' }));
    assert.equal(result.end.type, 'done'); assert.deepEqual(result.messages.find(message => message.type === 'log').values, ['中文', 'GBK']);
  });

  test('timer callbacks and native writes finish before done, async callback errors surface', async () => {
    const result = await run(`Timer.schedule(5,false,async()=>{ await new Promise(r=>setTimeout(r,5)); FileManager.local().writeString('/documents/timer','fired'); console.log('fired'); });`);
    assert.equal(result.end.type, 'done'); assert.equal(result.operations[0].payload.text, 'fired');
    const failed = await run(`Timer.schedule(1,false,async()=>{throw new Error('timer failure')});`); assert.equal(failed.end.type, 'error'); assert.match(failed.end.message, /timer failure/);
  });

  test('missing APIs and escaped app paths fail explicitly', async () => {
    for (const [code, pattern] of [[`FileManager.iCloud()`, /FileManager.iCloud.*not supported/], [`await Location.current()`, /Location.current.*not supported/], [`new CalendarEvent()`, /CalendarEvent.*not supported/], [`FileManager.local().writeString('/documents/../../outside','bad')`, /escapes app storage/], [`throw new Error('script failure')`, /script failure/]]) {
      const result = await run(code); assert.equal(result.end.type, 'error'); assert.match(result.end.message, pattern);
    }
  });

  test('DateFormatter common formats, Device and args are available', async () => {
    const result = await run(`const f=new DateFormatter(); f.dateFormat="yyyy-MM-dd 'at' HH:mm:ss"; console.log(f.string(new Date(2026,9,8,12,34,56)),Device.batteryLevel(),Device.systemName(),args.widgetParameter,config.runsInWidget);`, { args: { widgetParameter: 'hello' }, config: { runsInWidget: true, runsInApp: false } });
    assert.equal(result.end.type, 'done'); assert.deepEqual(result.messages.find(message => message.type === 'log').values, ['2026-10-08 at 12:34:56', 0.75, 'Android', 'hello', true]);
  });

  test('separate Worker can terminate an infinite loop without blocking parent', async () => {
    const worker = new Worker(__filename, { workerData: { runtimeHarness: true } });
    let completed = false;
    worker.on('message', message => { if (message.type === 'done') completed = true; });
    worker.postMessage({ type: 'run', code: 'while (true) {}', context: {} });
    await new Promise(resolve => setTimeout(resolve, 75));
    const exitCode = await worker.terminate(); assert.equal(typeof exitCode, 'number'); assert.equal(completed, false);
    const result = await run(`console.log('next run is healthy')`); assert.equal(result.end.type, 'done');
  });
}
