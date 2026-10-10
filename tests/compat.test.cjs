'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assetRoot = path.resolve(__dirname, '../app/src/main/assets');
async function run(code, handler = () => null, extra = {}) {
  const messages = [], operations = []; let finish;
  const ending = new Promise(resolve => { finish = resolve; });
  const sandbox = { setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array, URL, crypto: require('node:crypto').webcrypto, btoa: v => Buffer.from(v, 'binary').toString('base64'), atob: v => Buffer.from(v, 'base64').toString('binary') };
  sandbox.self = sandbox; vm.createContext(sandbox);
  sandbox.importScripts = (...names) => { for (const name of names) vm.runInContext(fs.readFileSync(path.join(assetRoot, name), 'utf8'), sandbox, { filename: name }); if (!names.includes('runtime-compat.js')) vm.runInContext(fs.readFileSync(path.join(assetRoot, 'runtime-compat.js'), 'utf8'), sandbox, { filename: 'runtime-compat.js' }); };
  sandbox.postMessage = message => {
    message = structuredClone(message); messages.push(message);
    if (message.type === 'host') { operations.push(message); Promise.resolve().then(() => handler(message)).then(result => sandbox.onmessage({ data: { type: 'hostResult', id: message.id, ok: true, result } }), error => sandbox.onmessage({ data: { type: 'hostResult', id: message.id, ok: false, error: error.message } })); }
    if (message.type === 'error' || message.type === 'done') finish(message);
  };
  vm.runInContext(fs.readFileSync(path.join(assetRoot, 'runtime.js'), 'utf8'), sandbox);
  sandbox.onmessage({ data: { type: 'run', code, context: { script: { id: 'compat', name: 'Compat' }, device: { locale: 'en-US' }, ...extra } } });
  const timeout = setTimeout(() => finish({ type: 'error', message: 'Harness timed out' }), 2000);
  const end = await ending; clearTimeout(timeout); return { end, messages, operations };
}
const logs = result => result.messages.filter(message => message.type === 'log').map(message => message.values);
test('Data.fromBytes and Data.fromFile read real bytes and respect private file errors', async () => {
  const result = await run(`const f=FileManager.local();const data=Data.fromBytes([0,127,128,255]);f.write('/documents/bytes',data);const copy=Data.fromFile('/documents/bytes');console.log(copy.getBytes(),copy.toBase64String());try{Data.fromFile('/documents/missing');}catch(e){console.log(e.message)}try{Data.fromBytes([256])}catch(e){console.log(e.message)}try{Data.fromBytes([1.2])}catch(e){console.log(e.message)}`);
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result)[0], [[0, 127, 128, 255], 'AH+A/w==']); assert.match(logs(result)[1][0], /does not exist/); assert.match(logs(result)[2][0], /0 and 255/); assert.match(logs(result)[3][0], /integers/); assert.equal(result.operations[0].action, 'file.op');
});
test('all documented Font factory methods exist; every rounded/mono weight produces a real Font', async () => {
  const inventory = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../docs/api-inventory.json'), 'utf8')).find(item => item.type === 'font').members.filter(member => member.startsWith('+')).map(member => member.slice(1));
  const result = await run(`const methods=${JSON.stringify(inventory)};console.log(methods.filter(name=>typeof Font[name]!=='function'));console.log(['ultraLight','thin','light','regular','medium','semibold','bold','heavy','black'].flatMap(weight=>['MonospacedSystemFont','RoundedSystemFont'].map(suffix=>{const f=Font[weight+suffix](19);return [f instanceof Font,f.family,f.size,f.weight]})));`);
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result)[0][0], []); const fonts = logs(result)[1][0]; assert.equal(fonts.length, 18); for (let i = 0; i < fonts.length; i++) { assert.equal(fonts[i][0], true); assert.equal(fonts[i][1], i % 2 ? 'sans-serif-rounded' : 'monospace'); assert.equal(fonts[i][2], 19); assert.equal(fonts[i][3], String((Math.floor(i / 2) + 1) * 100)); }
});
test('TextField returned by Alert serializes keyboard/font/color/alignment and receives edited values', async () => {
  let payload;
  const result = await run(`const a=new Alert();a.addAction('OK');const email=a.addTextField('Email','initial');email.text='alice@example.com';email.placeholder='Address';email.setEmailAddressKeyboard();email.centerAlignText();email.textColor=Color.blue();email.font=Font.boldRoundedSystemFont(18);const pin=a.addSecureTextField('PIN','1234');pin.setNumberPadKeyboard();console.log(email instanceof TextField,pin.isSecure,pin.text);const index=await a.presentAlert();console.log(index,email.text,email.value,pin.text,a.textFieldValue(0),a.textFieldValue(1));`, message => { if (message.action === 'alert') { payload = message.payload; return { index: 0, values: ['updated@example.com', '5678'] }; } });
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result)[0], [true, true, '1234']); assert.deepEqual(logs(result)[1], [0, 'updated@example.com', 'updated@example.com', '5678', 'updated@example.com', '5678']); assert.equal(payload.textFields[0].placeholder, 'Address'); assert.equal(payload.textFields[0].keyboardType, 'emailAddress'); assert.equal(payload.textFields[0].alignment, 'center'); assert.equal(payload.textFields[0].textColor, '#007AFF'); assert.equal(payload.textFields[0].font.family, 'sans-serif-rounded'); assert.equal(payload.textFields[0].font.weight, '700'); assert.equal(payload.textFields[1].keyboardType, 'numberPad'); assert.equal(payload.textFields[1].secure, true);
});
test('every documented TextField method is callable and all keyboard modes are observable by the host', async () => {
  const members = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../docs/api-inventory.json'), 'utf8')).find(item => item.type === 'textfield').members.filter(member => member.startsWith('-')).map(member => member.slice(1));
  const result = await run(`const field=new Alert().addTextField();console.log(${JSON.stringify(members)}.filter(name=>typeof field[name]!=='function'));const keyboards=['Default','NumberPad','DecimalPad','NumbersAndPunctuation','PhonePad','WebSearch','EmailAddress','URL','Twitter'];console.log(keyboards.map(name=>{field['set'+name+'Keyboard']();return field.keyboardType}));field.isSecure=true;field.rightAlignText();console.log(JSON.parse(JSON.stringify(field)));`);
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result)[0][0], []); assert.deepEqual(logs(result)[1][0], ['default', 'numberPad', 'decimalPad', 'numbersAndPunctuation', 'phonePad', 'webSearch', 'emailAddress', 'url', 'twitter']); assert.equal(logs(result)[2][0].secure, true); assert.equal(logs(result)[2][0].alignment, 'right');
});
test('URLScheme.parameter preserves actual values without inheriting object members and error aliases log at error severity', async () => {
  const result = await run(`console.log(URLScheme.parameter('city'),URLScheme.parameter('empty'),URLScheme.parameter('missing'),URLScheme.parameter('toString'));console.logError('native severity',42);logError('global severity');`, () => null, { args: { queryParameters: { city: '上海', empty: '' } } });
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result)[0], ['上海', '', null, null]); const errors = result.messages.filter(message => message.type === 'log' && message.level === 'error'); assert.equal(errors.length, 2); assert.deepEqual(errors[0].values, ['native severity', 42]);
});
