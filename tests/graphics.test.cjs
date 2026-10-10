'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createCanvas, Image: CanvasImage } = require('@napi-rs/canvas');
const { handle } = require('../tools/graphics-server.cjs');
const extension = fs.readFileSync(path.resolve(__dirname, '../app/src/main/assets/runtime-graphics.js'), 'utf8');
const core = fs.readFileSync(path.resolve(__dirname, '../app/src/main/assets/runtime.js'), 'utf8');
function environment(options = {}) {
  const sandbox = { postMessage() {}, setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array, console, crypto: require('node:crypto').webcrypto, btoa: v => Buffer.from(v, 'binary').toString('base64'), atob: v => Buffer.from(v, 'base64').toString('binary') };
  sandbox.self = sandbox; const context = vm.createContext(sandbox); vm.runInContext(core, context);
  function syncHost(action, payload) {
    if (action.startsWith('image.') || payload.commands?.some(c => c.op === 'image')) {
      const result = JSON.parse(execFileSync(process.execPath, ['-e', `let input='';process.stdin.on('data',v=>input+=v);process.stdin.on('end',async()=>{try{let v=JSON.parse(input);process.stdout.write(JSON.stringify({ok:true,result:await require('./tools/graphics-server.cjs').handle(v.action,v.payload)}));}catch(e){process.stdout.write(JSON.stringify({ok:false,error:e.message}));}});`], { cwd: path.resolve(__dirname, '..'), input: JSON.stringify({ action, payload }), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
      if (!result.ok) throw new Error(result.error); return result.result;
    }
    return handle(action, payload);
  }
  sandbox.__runtime = { context: { device: { locale: 'en-US', screenScale: 2, ...options } }, syncHost, register: map => Object.assign(sandbox, map) };
  vm.runInContext(extension, context);
  return code => vm.runInContext(code, context);
}
async function pixels(image) { const decoded = new CanvasImage(); decoded.src = Buffer.from(image.data.toBase64String(), 'base64'); await decoded.decode(); const canvas = createCanvas(decoded.width, decoded.height), ctx = canvas.getContext('2d'); ctx.drawImage(decoded, 0, 0); return { width: decoded.width, height: decoded.height, at: (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data), all: ctx.getImageData(0, 0, decoded.width, decoded.height).data }; }
test('DrawContext produces immediate real PNG pixels, alpha, screen scale and snapshots', async () => {
  const run = environment(); const first = run(`var dc = new DrawContext(); dc.size=new Size(20,20); dc.opaque=false; dc.setFillColor(new Color('ff0000',.5)); dc.fill(new Rect(0,0,10,20)); var first=dc.getImage(); first;`);
  assert.equal(first.then, undefined); const p = await pixels(first); assert.equal(p.width, 20); assert.deepEqual(p.at(3, 3), [255, 0, 0, 128]); assert.deepEqual(p.at(15, 3), [0, 0, 0, 0]);
  const second = run(`dc.setFillColor(Color.blue());dc.fillRect(new Rect(10,0,10,20));dc.respectScreenScale=true;dc.getImage();`);
  assert.equal((await pixels(second)).width, 40); assert.equal(first.size.width, 20); assert.deepEqual((await pixels(first)).at(15, 3), [0, 0, 0, 0]); assert.ok((await pixels(second)).at(30, 10)[2] > 200);
  const opaque = run(`var a=new DrawContext();a.size=new Size(5,5);a.getImage();`); assert.equal((await pixels(opaque)).at(0, 0)[3], 255);
});
test('Path draws cubic, quadratic, rounded rectangles and ellipse subpaths; latest path wins', async () => {
  const run = environment(); const image = run(`var d=new DrawContext();d.size=new Size(100,100);d.opaque=false;d.setFillColor(Color.red());var p=new Path();p.addRoundedRect(new Rect(10,10,30,30),8,8);p.addEllipse(new Rect(60,10,30,30));d.addPath(p);p.addRect(new Rect(0,70,100,20));d.fillPath();d.setStrokeColor(Color.green());d.setLineWidth(4);var q=new Path();q.move(new Point(10,65));q.addCurve(new Point(50,65),new Point(20,40),new Point(40,90));q.addQuadCurve(new Point(90,65),new Point(70,95));d.addPath(q);d.strokePath();d.getImage();`);
  const p = await pixels(image); assert.ok(p.at(25, 25)[0] > 240); assert.ok(p.at(75, 25)[0] > 240); assert.equal(p.at(10, 10)[3], 0); assert.equal(p.at(50, 75)[3], 0); assert.ok(p.at(50, 65)[1] > 100); assert.ok(p.at(70, 80)[1] > 100);
  const second = run(`var z=new Path();z.addLines([new Point(0,95),new Point(100,95)]);d.addPath(z);d.setStrokeColor(Color.blue());d.strokePath();d.getImage();`); assert.ok((await pixels(second)).at(50, 95)[2] > 150);
});
test('image composition, decoded size, PNG/JPEG transcode and transparent JPEG matte', async () => {
  const run = environment(); const original = run(`var d=new DrawContext();d.opaque=false;d.size=new Size(8,8);d.setFillColor(Color.red());d.fillEllipse(new Rect(0,0,8,8));var im=d.getImage(); im;`);
  const jpeg = run(`Data.fromJPEG(im,.95)`); assert.equal(jpeg.getBytes()[0], 255); assert.equal(jpeg.getBytes()[1], 216);
  run(`var jpg=Image.fromData(Data.fromJPEG(im));`); const png = run(`Data.fromPNG(jpg)`); assert.equal(png.getBytes()[0], 137); assert.equal(png.getBytes()[1], 80);
  const loaded = run(`Image.fromData(im.data)`); assert.equal(loaded.size.width, 8); assert.equal(loaded.size.height, 8);
  const composite = run(`var out=new DrawContext();out.opaque=false;out.size=new Size(30,30);out.drawImageAtPoint(im,new Point(2,2));out.drawImageInRect(jpg,new Rect(12,12,16,16));out.getImage();`); const p = await pixels(composite); assert.ok(p.at(5, 5)[0] > 200); assert.ok(p.at(19, 19)[0] > 200); assert.equal(p.at(0, 0)[3], 0); assert.deepEqual((await pixels(original)).at(0, 0), [0, 0, 0, 0]);
  assert.throws(() => run(`Image.fromData(Data.fromString('invalid'))`), /2048|image|Image/); assert.throws(() => run(`Data.fromJPEG(im,2)`), /quality/);
});
test('CJK text, multiline wrapping and alignment produce visible clipped glyphs', async () => {
  const run = environment({ locale: 'zh-CN' }); const image = run(`var d=new DrawContext();d.opaque=false;d.size=new Size(120,80);d.setFont(Font.boldSystemFont(20));d.setTextColor(Color.white());d.setTextAlignedCenter();d.drawTextInRect('安卓脚本\\nHello',new Rect(20,0,80,70));d.getImage();`);
  const p = await pixels(image); let lit = 0; for (let i = 3; i < p.all.length; i += 4) if (p.all[i]) lit++; assert.ok(lit > 200); for (let y = 0; y < 80; y++) { assert.equal(p.at(0, y)[3], 0); assert.equal(p.at(119, y)[3], 0); }
});
test('original semantic symbols have real images, distinct icons and font/weight sizing', async () => {
  const run = environment(); const sun = run(`var sun=SFSymbol.named('sun.max.fill');sun.applyFont(Font.boldSystemFont(48));sun.image;`), wifi = run(`var wifi=SFSymbol.named('wifi');wifi.applyThinWeight();wifi.image;`);
  assert.equal(sun.size.width, 48); assert.equal(wifi.size.width, 24); assert.ok((await pixels(sun)).at(24, 24)[3] > 200); assert.equal((await pixels(wifi)).at(1, 22)[3], 0); assert.notEqual(sun.data.toBase64String(), wifi.data.toBase64String()); assert.equal(run(`SFSymbol.named('not.a.symbol')`), null);
  for (const name of ['heart.fill', 'cloud.rain.fill', 'battery.75', 'person.circle', 'lock', 'calendar', 'checkmark.circle.fill']) assert.ok(run(`SFSymbol.named(${JSON.stringify(name)}).image`).size.width > 0);
});
test('native-equivalent preview renderer rejects bitmap bombs and excessive drawings', async () => {
  assert.throws(() => handle('graphics.render', { width: 2049, height: 1, commands: [] }), /2048/);
  assert.throws(() => handle('graphics.render', { width: 1000, height: 1000, scale: 3, commands: [] }), /2048/);
  assert.throws(() => handle('graphics.render', { width: 2, height: 2, commands: Array(10001).fill({ op: 'fillRect' }) }), /10000/);
  const fake = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(fake); fake.writeUInt32BE(999999, 16); fake.writeUInt32BE(999999, 20); await assert.rejects(handle('image.info', { base64: fake.toString('base64') }), /2048/);
});
test('LinearGradient validates locations and serializes colors/direction', () => {
  const run = environment(); const json = run(`var g=new LinearGradient();g.colors=[Color.red(),Color.blue()];g.locations=[0,1];g.startPoint=new Point(1,0);JSON.stringify(g);`); const parsed = JSON.parse(json); assert.equal(parsed.colors.length, 2); assert.equal(parsed.startPoint.x, 1); assert.throws(() => run(`g.locations=[.8,.1];JSON.stringify(g)`), /ordered/);
});
test('DateFormatter custom numeric, localized month, timezone and quoted literal round trips', () => {
  const run = environment(); const result = run(`var f=new DateFormatter();f.dateFormat="yyyy-MM-dd'T'HH:mm:ss.SSSXXX";var dt=f.date('2026-10-08T17:42:09.123+02:30');[dt.toISOString(),f.date('2026-02-30T17:42:09.123Z'),f.string(dt)];`); assert.equal(result[0], '2026-10-08T15:12:09.123Z'); assert.equal(result[1], null);
  const month = run(`f.dateFormat="MMMM d, yyyy 'at' h:mm a";var dt=f.date('October 8, 2026 at 7:05 PM');[dt.getMonth(),dt.getDate(),dt.getHours(),f.string(dt)];`); assert.equal(month[0], 9); assert.equal(month[1], 8); assert.equal(month[2], 19); assert.equal(month[3], 'October 8, 2026 at 7:05 PM');
  assert.equal(run(`f.dateFormat="yyyy-MM-dd";f.date('2026-02-29')`), null); assert.equal(run(`f.date('2024-02-29').getDate()`), 29);
  assert.equal(run(`f.dateFormat="yyyy-MM-dd 'it''s' HH:mm";f.string(new Date(2026,9,8,5,7))`), "2026-10-08 it's 05:07");
  assert.equal(run(`f.timeZone='UTC';f.dateFormat='yyyy-MM-dd HH:mm';f.date('2026-10-08 05:07').toISOString()`), '2026-10-08T05:07:00.000Z');
});
test('DateFormatter native locale styles are parseable and RelativeDateTimeFormatter has named/numeric modes', () => {
  const run = environment(); assert.equal(run(`var f=new DateFormatter();f.useLongDateStyle();var s=f.string(new Date(2026,9,8));f.date(s).getMonth()`), 9);
  const result = run(`var r=new RelativeDateTimeFormatter();var now=new Date(2026,9,8,12);var yesterday=new Date(now.getTime()-86400000);var named=r.string(yesterday,now);r.useNumericDateTimeStyle();[named,r.string(yesterday,now),r.string(new Date(now.getTime()+600000),now)];`); assert.equal(result[0], 'yesterday'); assert.equal(result[1], '1 day ago'); assert.equal(result[2], 'in 10 minutes');
});
test('XMLParser callbacks preserve entities, CDATA, namespaces, comments and empty attributes', () => {
  const run = environment(); const result = run(`var events=[];var parser=new XMLParser('<?xml version="1.0"?><root xmlns:x="urn:x" title="a &amp; b"><!--hi--><x:item id="1">A &#x1F600;<![CDATA[<B>]]></x:item><empty value=""/></root>');parser.didStartDocument=()=>events.push('start');parser.didStartElement=(n,a)=>events.push(['open',n,a]);parser.foundCharacters=s=>events.push(['text',s]);parser.didEndElement=n=>events.push(['close',n]);parser.didEndDocument=()=>events.push('end');[parser.parse(),JSON.stringify(events)];`);
  assert.equal(result[0], true); const events = JSON.parse(result[1]); assert.equal(events[0], 'start'); assert.equal(events[1][2].title, 'a & b'); assert.ok(events.some(e => e[0] === 'text' && e[1] === 'A 😀')); assert.ok(events.some(e => e[0] === 'text' && e[1] === '<B>')); assert.equal(events.at(-1), 'end');
});
test('XMLParser rejects malformed input and custom/external entities without successful end callback', () => {
  const run = environment(); for (const xml of ['<a></b>', '<a/><b/>', '<a x="1" x="2"/>', '<a>&unknown;</a>', '<a><![CDATA[unfinished', '<a>', '<!DOCTYPE a [<!ENTITY evil SYSTEM "file:///etc/passwd">]><a>&evil;</a>', '<a>bad & text</a>']) {
    const result = run(`var ended=false,errors=0;var p=new XMLParser(${JSON.stringify(xml)});p.didEndDocument=()=>ended=true;p.parseErrorOccurred=()=>errors++;[p.parse(),ended,errors,p.error.message];`); assert.equal(result[0], false, xml); assert.equal(result[1], false, xml); assert.equal(result[2], 1, xml); assert.match(result[3], /line/);
  }
});
