'use strict';
// Execute the exact shipped examples through real Worker messages and every API
// extension. Provider responses are synthetic fixtures: this is not Android OS,
// permissions, notification delivery, or native view/color parsing validation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const assets = path.resolve(__dirname, '../app/src/main/assets');
const examples = JSON.parse(fs.readFileSync(path.join(assets, 'examples.json'), 'utf8'));
const extensionNames = ['runtime-graphics.js', 'runtime-system.js', 'runtime-ui.js', 'runtime-extra.js', 'runtime-compat.js', 'runtime-symbols.js', 'runtime-library.js', 'runtime-platform.js'];

if (!isMainThread && workerData?.demoHarness) {
  const graphics = require('../tools/graphics-server.cjs');
  const symbols = require('../tools/symbols-server.cjs');
  const sandbox = {
    setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array, URL,
    crypto: require('node:crypto').webcrypto,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    postMessage: message => parentPort.postMessage(message),
    XMLHttpRequest: class {
      open(method, url, asynchronous) { assert.equal(method, 'GET'); assert.equal(asynchronous, false); this.url = url; }
      send() {
        const url = new URL(this.url), action = url.searchParams.get('action');
        const payload = JSON.parse(url.searchParams.get('payload'));
        parentPort.postMessage({ type: 'fixtureSync', action, payload });
        this.status = 200;
        try {
          let result;
          if (action === 'device.battery') result = { level: .75, isCharging: true, isDischarging: false, isFullyCharged: false };
          else if (action === 'date.format') {
            assert.equal(payload.locale, 'zh-CN'); assert.ok(Number.isFinite(payload.timestamp)); assert.equal(payload.timeZone, null);
            const formattedFixtures = { 'MM-dd HH:mm': '10-10 12:34', 'MM月dd日 EEEE': '10月10日 星期六' };
            assert.ok(Object.hasOwn(formattedFixtures, payload.dateFormat), 'Unexpected native date pattern');
            result = formattedFixtures[payload.dateFormat];
          }
          else if (action.startsWith('graphics.')) result = graphics.handle(action, payload);
          else if (action.startsWith('symbols.')) result = symbols.handle(action, payload);
          else throw new Error('Unexpected synchronous host operation: ' + action);
          assert.equal(result?.then, undefined, 'Fixture must reply synchronously');
          this.responseText = JSON.stringify({ ok: true, result });
        } catch (error) { this.responseText = JSON.stringify({ ok: false, error: error.message }); }
      }
    }
  };
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  sandbox.importScripts = (...names) => {
    assert.deepEqual(names, extensionNames, 'Load the same complete API extension set as the app');
    for (const name of names) vm.runInContext(fs.readFileSync(path.join(assets, name), 'utf8'), context, { filename: name });
    parentPort.postMessage({ type: 'fixtureImports', names });
  };
  vm.runInContext(fs.readFileSync(path.join(assets, 'runtime.js'), 'utf8'), context, { filename: 'runtime.js' });
  parentPort.on('message', message => {
    Promise.resolve(sandbox.onmessage({ data: message })).catch(error => parentPort.postMessage({ type: 'error', message: error.message, stack: error.stack }));
  });
} else {
  const noteText = '今天的灵感：给每个示例做真实运行回归。';
  const networkTodo = { userId: 1, id: 1, title: 'fixture todo', completed: false };
  const calendar = { identifier: 'fixture-calendar', title: 'Fixture Calendar', kind: 'events', color: '#6370ee', allowsContentModifications: true };
  const current = new Date();
  const fixtureEvent = { identifier: 'fixture-event', title: 'Fixture event', startDate: current.getTime(), endDate: current.getTime() + 60000, calendar };
  const logs = result => result.messages.filter(message => message.type === 'log').map(message => message.values);
  const actions = result => result.operations.map(operation => operation.action);
  const byId = id => { const example = examples.find(item => item.id === id); assert.ok(example, id + ' must be bundled'); return example; };
  async function pixels(uri) {
    const { createCanvas, Image } = require('@napi-rs/canvas');
    assert.match(uri, /^data:image\/png;base64,/);
    const decoded = new Image(); decoded.src = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64'); await decoded.decode();
    const canvas = createCanvas(decoded.width, decoded.height), context = canvas.getContext('2d');
    context.drawImage(decoded, 0, 0);
    const data = context.getImageData(0, 0, decoded.width, decoded.height).data;
    return { width: decoded.width, height: decoded.height, at: (x, y) => [...context.getImageData(x, y, 1, 1).data], filled: [...data].filter((v, i) => i % 4 === 3 && v > 0).length };
  }
  function validateAlertFields(payload) {
    assert.ok(Array.isArray(payload.textFields));
    for (const field of payload.textFields) {
      assert.equal(typeof field.placeholder, 'string'); assert.equal(typeof field.value, 'string');
      assert.equal(field.secure, false); assert.equal(field.textColor, null); assert.equal(field.font, null);
      assert.equal(field.alignment, 'left'); assert.equal(field.keyboardType, 'default');
    }
  }
  function validateWidget(tree) {
    assert.equal(tree.type, 'widget'); assert.ok(tree.children.length > 0);
    const visit = node => {
      for (const property of ['backgroundColor', 'color', 'tintColor', 'borderColor']) {
        if (node[property] != null) assert.match(node[property], /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i);
      }
      for (const child of node.children || []) visit(child);
    };
    visit(tree);
  }
  async function runExample(example, options = {}) {
    const messages = [], operations = [], syncOperations = [], imports = [], files = structuredClone(options.files || {});
    const notifications = [], webviews = new Map();
    let clipboard = '  第一段\n\n\n\n第二段  ', terminal;
    const worker = new Worker(__filename, { workerData: { demoHarness: true } });
    const reply = (operation, ok, result, error) => worker.postMessage({ type: 'hostResult', id: operation.id, ok, result, error });
    const emit = (operation, event) => worker.postMessage({ type: 'hostEvent', id: operation.id, event });
    async function host(operation) {
      const p = operation.payload;
      if (options.rejectAction === operation.action) throw new Error('Fixture native rejection: ' + operation.action);
      switch (operation.action) {
        case 'alert': {
          validateAlertFields(p); assert.equal(p.textFields.length, 1); assert.equal(p.actions.length, 1);
          const value = example.id === 'example-notes' ? noteText : '测试者';
          return { index: options.cancelAlert ? -1 : 0, values: [value] };
        }
        case 'file.op':
          assert.equal(p.op, 'writeString'); assert.match(p.path, /^\/documents\//); assert.equal(typeof p.text, 'string');
          files[p.path] = { type: 'file', text: p.text, modifiedAt: Date.now() };
          return true;
        case 'widget.save': validateWidget(p.tree); assert.equal(p.scriptId, example.id); return true;
        case 'request':
          assert.equal(p.url, 'https://jsonplaceholder.typicode.com/todos/1'); assert.equal(p.method, 'GET');
          assert.equal(p.timeoutInterval, 15); assert.equal(p.encoding, 'text');
          return { body: JSON.stringify(networkTodo), statusCode: 200, headers: { 'Content-Type': 'application/json' }, url: p.url, mimeType: 'application/json', textEncodingName: 'UTF-8' };
        case 'clipboard.read': return clipboard;
        case 'clipboard.write': assert.equal(typeof p.text, 'string'); clipboard = p.text; return true;
        case 'notification.schedule':
          assert.equal(p.scriptId, example.id); assert.equal(typeof p.identifier, 'string'); assert.ok(p.title); assert.ok(p.body);
          notifications.push(p);
          // Record only; never deliver a notification or install a real alarm.
          return { ...p, deliveryDate: p.triggerDate == null ? Date.now() : null, nextTriggerDate: p.triggerDate ?? null };
        case 'table.present': {
          assert.equal(p.rows.length, 3); assert.equal(p.showSeparators, true);
          const row = p.rows[1]; assert.equal(row.dismissOnSelect, false); assert.equal(row.selectable, true);
          emit(operation, { type: 'select', tableId: p.tableId, rowId: row.rowId, index: 1 });
          await new Promise(resolve => setTimeout(resolve, 20));
          return null; // Simulate the user dismissing after selection.
        }
        case 'webview.load':
          assert.equal(p.mode, 'html'); assert.match(p.html, /本地网页/); assert.match(p.html, /<button/);
          webviews.set(p.webviewId, { html: p.html, context: vm.createContext({}) }); return null;
        case 'webview.evaluate': {
          const view = webviews.get(p.webviewId); assert.ok(view, 'Load precedes evaluation'); assert.equal(p.javaScript, '6*7');
          assert.equal(p.useCallback, false); return vm.runInContext(p.javaScript, view.context, { timeout: 100 });
        }
        case 'webview.present': assert.ok(webviews.has(p.webviewId)); return null;
        case 'location.current': assert.equal(p.accuracy, 100); return { latitude: 30.25, longitude: 120.25, horizontalAccuracy: 50 };
        case 'calendar.list': assert.deepEqual(p, { kind: 'events' }); return [calendar];
        case 'event.list': assert.ok(p.startDate < p.endDate); assert.equal(p.calendars, null); return [fixtureEvent];
        case 'contacts.list': assert.equal(p.containers, null); return [{ identifier: 'fixture-person', givenName: 'Fixture', familyName: 'Person' }];
        default: throw new Error('Unexpected host operation: ' + operation.action);
      }
    }
    const ending = new Promise((resolve, reject) => {
      worker.on('error', reject);
      worker.on('exit', code => { if (!terminal) reject(new Error('Worker exited without a terminal message: ' + code)); });
      worker.on('message', message => {
        messages.push(message);
        if (message.type === 'fixtureSync') syncOperations.push(message);
        if (message.type === 'fixtureImports') imports.push(message.names);
        if (message.type === 'host') {
          operations.push(message);
          host(message).then(result => reply(message, true, result), error => reply(message, false, null, error.message));
        }
        if (message.type === 'done' || message.type === 'error') { terminal = message; resolve(message); }
      });
    });
    worker.postMessage({ type: 'run', code: example.code, context: {
      script: example, scripts: [example], files, clipboard,
      nativeSyncUrl: 'https://fixture.invalid/native-sync', nativeRuntime: true,
      device: { name: 'Fixture Phone', model: 'Fixture Pixel', systemName: 'Android', locale: 'zh-CN', screenSize: { width: 412, height: 915 }, screenScale: 2, batteryLevel: .75, isCharging: true },
      args: { widgetParameter: '测试实例参数' }, ...options.context
    } });
    let timeout;
    try {
      const end = await Promise.race([ending, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Example timed out: ' + example.name)), 5000); })]);
      assert.deepEqual(imports, [extensionNames]);
      return { end, messages, operations, syncOperations, files, notifications, clipboard };
    } finally { clearTimeout(timeout); await worker.terminate(); }
  }
  const expectedActions = {
    'example-hello': ['alert'], 'example-device': ['widget.save'], 'example-notes': ['alert', 'file.op'],
    'example-request': ['request'], 'example-clipboard': ['clipboard.read', 'clipboard.write'],
    'example-date': ['widget.save'], 'example-module': ['file.op'], 'example-notification': ['notification.schedule'],
    'example-graphics': [], 'example-symbols': [], 'example-gradient': ['widget.save'], 'example-xml': [],
    'example-table': ['table.present'], 'example-html': ['webview.load', 'webview.evaluate', 'webview.present'],
    'example-triggers': ['notification.schedule', 'notification.schedule'], 'example-location-read': ['location.current'],
    'example-counts-read': ['calendar.list', 'event.list', 'contacts.list'], 'example-widget-parameter': ['widget.save'],
    'example-self-read': [], 'example-shortcut-uri': []
  };
  test('every bundled demo has a behavioral assertion and an explicit host contract', () => {
    assert.equal(examples.length, 20); assert.deepEqual(examples.map(item => item.id).sort(), Object.keys(expectedActions).sort());
  });
  for (const example of examples) test('bundled demo completes: ' + example.name, async () => {
    const result = await runExample(example);
    assert.equal(result.end.type, 'done', result.end.message + '\n' + (result.end.stack || ''));
    assert.deepEqual(actions(result), expectedActions[example.id]);
    assert.equal(result.messages.filter(message => message.type === 'done' || message.type === 'error').length, 1);
    assert.equal(result.messages.filter(message => message.type === 'log' && message.level === 'error').length, 0);
    const output = logs(result), widgets = result.messages.filter(message => message.type === 'widget');
    switch (example.id) {
      case 'example-hello': assert.deepEqual(output, [['你好，测试者！'], ['你的第一个 JavaScript 脚本运行成功。']]); break;
      case 'example-device':
        assert.deepEqual(result.syncOperations.map(item => item.action), ['device.battery', 'device.battery', 'date.format']);
        assert.equal(widgets.length, 2); assert.equal(widgets[0].tree.children[0].text, '我的 Android');
        assert.match(widgets[0].tree.children[4].text, /75%.*充电中/); assert.equal(widgets[0].tree.children[6].text, '更新于 10-10 12:34'); break;
      case 'example-notes': assert.equal(result.files['/documents/my-note.txt'].text, noteText); assert.equal(output[1][0], noteText); break;
      case 'example-request':
        assert.deepEqual(output, [['HTTP 状态：200'], ['任务：fixture todo'], ['完成状态：待完成']]);
        assert.deepEqual(JSON.parse(result.messages.find(message => message.type === 'preview').value), networkTodo); break;
      case 'example-clipboard': assert.equal(result.clipboard, '第一段\n\n第二段'); assert.equal(output[1][0], result.clipboard); break;
      case 'example-date':
        assert.deepEqual(result.syncOperations.map(item => item.action), ['date.format']);
        assert.equal(widgets.length, 2); assert.equal(widgets[0].tree.children[0].text, '今天也，慢慢来。');
        assert.equal(widgets[0].tree.children[2].text, '10月10日 星期六'); break;
      case 'example-module': assert.equal(output[0][0], '你好，Android！'); assert.match(result.files['/documents/greeting-tools.js'].text, /module\.exports/); break;
      case 'example-notification': assert.equal(result.notifications.length, 1); assert.equal(result.notifications[0].triggerDate, undefined); assert.deepEqual(output, [['通知已发送。']]); break;
      case 'example-graphics': {
        assert.deepEqual(result.syncOperations.map(item => item.action), ['graphics.render']);
        const preview = result.messages.find(message => message.type === 'preview'); assert.equal(preview.format, 'image');
        const bytes = Buffer.from(preview.value.slice(preview.value.indexOf(',') + 1), 'base64');
        assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
        assert.equal(bytes.readUInt32BE(16), 320); assert.equal(bytes.readUInt32BE(20), 180); assert.ok(bytes.length > 1000);
        const p = await pixels(preview.value); assert.deepEqual(p.at(10, 10), [238, 241, 255, 255]); assert.deepEqual(p.at(250, 55), [90, 93, 232, 255]); break;
      }
      case 'example-symbols': {
        assert.ok(result.syncOperations.some(item => item.action === 'symbols.catalog'));
        assert.ok(result.syncOperations.some(item => item.action === 'symbols.render'));
        assert.equal(widgets.length, 1); assert.equal(widgets[0].tree.children[0].children.filter(item => item.type === 'image').length, 3);
        const images = widgets[0].tree.children[0].children.map(item => item.image);
        assert.equal(new Set(images).size, 3);
        for (const uri of images) { const p = await pixels(uri); assert.equal(p.width, 40); assert.equal(p.height, 40); assert.ok(p.filled > 50 && p.filled < 1600); }
        assert.equal(output.length, 3); assert.ok(output.every(values => values[2] === false)); break;
      }
      case 'example-gradient':
        assert.equal(widgets.length, 2); assert.deepEqual(widgets[0].tree.backgroundGradient.colors, ['#5A5DE8', '#23A8BA']);
        assert.equal(widgets[0].tree.children[0].text, '测试实例参数'); assert.equal(widgets[0].tree.children[2].dateStyle, 'time'); break;
      case 'example-xml': assert.deepEqual(output, [['items', {}], ['item', { id: '1' }], ['你好'], [true]]); break;
      case 'example-table': assert.deepEqual(output, [['已选择：读一页书']]); break;
      case 'example-html': assert.deepEqual(output, [['计算结果', 42]]); break;
      case 'example-triggers':
        assert.equal(result.notifications.length, 2); assert.equal(result.notifications[0].triggerDate, undefined);
        assert.ok(result.notifications[1].triggerDate - Date.now() > 115000); assert.ok(result.notifications[1].triggerDate - Date.now() <= 120000);
        assert.equal(output[0][1], result.notifications[1].identifier); break;
      case 'example-location-read': assert.deepEqual(output, [[30.25, 120.25]]); break;
      case 'example-counts-read': assert.deepEqual(output, [['日历账户数量', 1], ['今天的事件数量', 1], ['联系人数量', 1]]); break;
      case 'example-widget-parameter': assert.equal(widgets[0].tree.children[0].text, '测试实例参数'); break;
      case 'example-self-read':
        assert.deepEqual(output, [['文件路径', '/documents/' + example.name + '.js'], ['行数', example.code.split('\n').length], ['字符数', example.code.length]]); break;
      case 'example-shortcut-uri':
        assert.equal(output[1][0], 'scriptable-android://run?id=' + example.id + '&scriptName=' + encodeURIComponent(example.name)); break;
      default: assert.fail('Missing behavioral assertion for ' + example.id);
    }
  });
  test('notes demo reads persisted content on next run and cancellation keeps it', async () => {
    const example = byId('example-notes'), initial = await runExample(example);
    assert.equal(initial.end.type, 'done');
    const again = await runExample(example, { files: initial.files });
    assert.equal(again.end.type, 'done'); assert.equal(again.operations[0].payload.textFields[0].value, noteText);
    const cancelled = await runExample(example, { files: initial.files, cancelAlert: true });
    assert.equal(cancelled.end.type, 'done'); assert.deepEqual(actions(cancelled), ['alert']);
    assert.equal(cancelled.files['/documents/my-note.txt'].text, noteText);
    assert.deepEqual(logs(cancelled), [['已取消，原来的笔记仍然保留。']]);
  });
  test('an Alert host failure surfaces instead of a false demo success', async () => {
    const result = await runExample(byId('example-notes'), { rejectAction: 'alert' });
    assert.equal(result.end.type, 'error'); assert.match(result.end.message, /Fixture native rejection: alert/);
    assert.deepEqual(actions(result), ['alert']); assert.equal(result.files['/documents/my-note.txt'], undefined);
  });
  test('note storage failure surfaces after the save action', async () => {
    const result = await runExample(byId('example-notes'), { rejectAction: 'file.op' });
    assert.equal(result.end.type, 'error'); assert.match(result.end.message, /Fixture native rejection: file\.op/);
    assert.deepEqual(actions(result), ['alert', 'file.op']); assert.equal(result.files['/documents/my-note.txt'], undefined);
  });
  test('hello cancellation and widget background mode settle without extra effects', async () => {
    const hello = await runExample(byId('example-hello'), { cancelAlert: true });
    assert.equal(hello.end.type, 'done'); assert.deepEqual(logs(hello), [['随时欢迎回来。']]);
    const widget = await runExample(byId('example-widget-parameter'), { context: { config: { runsInWidget: true, widgetId: 17, widgetFamily: 'small' } } });
    assert.equal(widget.end.type, 'done'); assert.equal(widget.messages.filter(message => message.type === 'widget').length, 1);
    assert.equal(widget.operations[0].payload.targetWidgetId, 17); assert.equal(widget.operations[0].payload.family, 'small');
  });
}
