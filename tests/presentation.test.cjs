'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assets = path.resolve(__dirname, '../app/src/main/assets');

async function run(code, handler = () => null, extra = {}) {
  const messages = [], operations = []; let sandbox, finish;
  const ending = new Promise(resolve => { finish = resolve; });
  sandbox = {TextEncoder,TextDecoder,Uint8Array,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,
    btoa:value=>Buffer.from(value,'binary').toString('base64'),atob:value=>Buffer.from(value,'base64').toString('binary'),
    postMessage(message) {
      message=structuredClone(message);messages.push(message);
      if(message.type==='host') { operations.push(message);Promise.resolve().then(()=>handler(message,event=>sandbox.onmessage({data:{type:'hostEvent',id:message.id,event}}))).then(result=>sandbox.onmessage({data:{type:'hostResult',id:message.id,ok:true,result}}),error=>sandbox.onmessage({data:{type:'hostResult',id:message.id,ok:false,error:error.message}})); }
      if(message.type==='error'||message.type==='done')finish(message);
    }};
  sandbox.self=sandbox;
  const context=vm.createContext(sandbox);
  sandbox.importScripts=(...names)=>{for(const name of names)if(name==='runtime-ui.js')vm.runInContext(fs.readFileSync(path.join(assets,name),'utf8'),context,{filename:name});};
  vm.runInContext(fs.readFileSync(path.join(assets,'runtime.js'),'utf8'),context,{filename:'runtime.js'});
  sandbox.onmessage({data:{type:'run',code,context:{script:{id:'presentation-test',name:'展示测试'},device:{locale:'en-US'},...extra}}});
  const timer=setTimeout(()=>finish({type:'error',message:'Timed out'}),3000), end=await ending;clearTimeout(timer);return {end,messages,operations};
}

test('WebView loads isolated HTML and evaluates with completion semantics',async()=>{
  const result=await run(`const v=new WebView();await v.loadHTML('<h1>Hello</h1>','https://example.com/');console.log(await v.evaluateJavaScript('completion({value:42})',true));console.log(await v.getHTML());await v.present(true);await v.close();`,message=>{
    if(message.action==='webview.evaluate')return message.payload.useCallback?{value:42}:'<html>Hello</html>';
    return null;
  });
  assert.equal(result.end.type,'done');assert.deepEqual(result.operations.map(item=>item.action),['webview.load','webview.evaluate','webview.evaluate','webview.present','webview.close']);
  assert.equal(result.operations[0].payload.baseURL,'https://example.com/');assert.equal(result.operations[1].payload.useCallback,true);assert.equal(result.operations[3].payload.fullscreen,true);
  assert.deepEqual(result.messages.filter(item=>item.type==='log').map(item=>item.values),[[{value:42}],['<html>Hello</html>']]);
});

test('WebView static loaders close views after presentation failure',async()=>{
  const result=await run(`try{await WebView.loadURL('https://example.com',new Size(200,100),true)}catch(e){console.log(e.message)}`,message=>{if(message.action==='webview.present')throw new Error('closed by host');});
  assert.equal(result.end.type,'done');assert.deepEqual(result.operations.map(item=>item.action),['webview.load','webview.present','webview.close']);assert.equal(result.messages.find(item=>item.type==='log').values[0],'closed by host');
});

test('WebView loadRequest uses full HTTP transport with non-GET request',async()=>{
  const result=await run(`const r=new Request('https://example.com');r.method='PUT';r.body='value';const w=new WebView();await w.loadRequest(r);`,message=>message.action==='request'?{body:Buffer.from('<p>response</p>').toString('base64'),statusCode:200,mimeType:'text/html',url:'https://example.com/result'}:null);
  assert.equal(result.end.type,'done');assert.equal(result.operations[0].action,'request');assert.equal(result.operations[0].payload.method,'PUT');assert.equal(result.operations[1].payload.html,'<p>response</p>');assert.equal(result.operations[1].payload.baseURL,'https://example.com/result');
});

test('UITable selectable rows and tappable cells run callbacks and reload changed rows',async()=>{
  let tablePayload;
  const result=await run(`const table=new UITable();table.showSeparators=true;const row=new UITableRow();row.dismissOnSelect=false;row.addText('Title','Subtitle').widthWeight=3;row.onSelect=i=>{console.log('selected',i);row.cells[0].title='Changed';table.reload();};const button=row.addButton('Go');button.onTap=()=>console.log('button');table.addRow(row);await table.present(true);`,async(message,emit)=>{
    if(message.action==='table.present'){tablePayload=message.payload;const row=tablePayload.rows[0];emit({type:'select',tableId:tablePayload.tableId,rowId:row.rowId,index:0});await new Promise(resolve=>setTimeout(resolve,15));emit({type:'tap',tableId:tablePayload.tableId,rowId:row.rowId,cellId:row.cells[1].cellId,index:0});await new Promise(resolve=>setTimeout(resolve,15));}
  });
  assert.equal(result.end.type,'done');assert.equal(tablePayload.rows[0].selectable,true);assert.equal(tablePayload.rows[0].cells[1].tappable,true);assert.equal(tablePayload.showSeparators,true);
  assert.deepEqual(result.messages.filter(item=>item.type==='log').map(item=>item.values),[['selected',0],['button']]);assert.equal(result.operations.find(item=>item.action==='table.reload').payload.rows[0].cells[0].title,'Changed');
});

test('UITable asynchronous callbacks finish before runtime completion and failures surface',async()=>{
  const result=await run(`const t=new UITable(),r=new UITableRow();r.addButton('Fail').onTap=async()=>{await new Promise(resolve=>setTimeout(resolve,30));throw new Error('callback failed')};t.addRow(r);await t.present();`,async(message,emit)=>{
    if(message.action==='table.present'){const row=message.payload.rows[0];emit({type:'tap',tableId:message.payload.tableId,rowId:row.rowId,cellId:row.cells[0].cellId,index:0});await new Promise(resolve=>setTimeout(resolve,5));}
  });
  assert.equal(result.end.type,'error');assert.equal(result.end.message,'callback failed');
});

test('shouldAllowRequest can reject or permit navigation through event messages',async()=>{
  const result=await run(`const w=new WebView();w.shouldAllowRequest=r=>!r.url.includes('blocked');await w.loadHTML('<p>test</p>');await w.present();`,async(message,emit)=>{
    if(message.action==='webview.present'){emit({type:'navigation',webviewId:message.payload.webviewId,navigationId:'one',url:'https://example.com/blocked'});emit({type:'navigation',webviewId:message.payload.webviewId,navigationId:'two',url:'https://example.com/open'});await new Promise(resolve=>setTimeout(resolve,10));}
  });
  assert.equal(result.end.type,'done');assert.equal(result.operations[0].payload.interceptNavigation,true);assert.deepEqual(result.operations.filter(item=>item.action==='webview.navigate').map(item=>item.payload.allow),[false,true]);
});

test('CallbackURL encodes queries before fragments and waits for app callback results',async()=>{
  const result=await run(`const c=new CallbackURL('another://x-callback-url/action?existing=1#fragment');c.addParameter('汉字','a & b');console.log(c.getURL());console.log(await c.open());console.log(URLScheme.forRunningScript(),URLScheme.allParameters());`,message=>message.action==='callback.open'?{answer:'done'}:null,{args:{queryParameters:{value:'42'}}});
  assert.equal(result.end.type,'done');const logs=result.messages.filter(item=>item.type==='log');assert.match(logs[0].values[0],/existing=1&%E6%B1%89%E5%AD%97=a%20%26%20b#fragment$/);assert.deepEqual(logs[1].values,[{answer:'done'}]);assert.match(logs[2].values[0],/^scriptable-android:\/\/run\?id=presentation-test/);assert.deepEqual(logs[2].values[1],{value:'42'});
});

test('WidgetDate styles, gradients and per-widget identity are persisted',async()=>{
  const result=await run(`const widget=new ListWidget(),gradient=new LinearGradient();gradient.colors=[Color.blue(),Color.purple()];gradient.locations=[0,1];widget.backgroundGradient=gradient;widget.refreshAfterDate=new Date('2030-01-01T00:00:00Z');const row=widget.addStack();row.addDate(new Date('2026-01-01T12:00:00Z')).applyTimerStyle();Script.setWidget(widget);await widget.presentAccessoryCircular();`,()=>null,{args:{widgetParameter:'city'},config:{runsInWidget:true,widgetId:12,widgetFamily:'small'}});
  assert.equal(result.end.type,'done');const saved=result.operations.find(item=>item.action==='widget.save').payload;assert.equal(saved.targetWidgetId,12);assert.equal(saved.parameter,'city');assert.equal(saved.family,'small');assert.equal(saved.tree.children[0].children[0].type,'date');assert.equal(saved.tree.children[0].children[0].dateStyle,'timer');assert.deepEqual(saved.tree.backgroundGradient.locations,[0,1]);assert.equal(saved.tree.refreshAfterDate,'2030-01-01T00:00:00.000Z');assert.equal(result.messages.at(-2).type,'host');
});

test('Invalid gradient locations and invalid UI types fail explicitly',async()=>{
  const gradient=await run(`const w=new ListWidget(),g=new LinearGradient();g.colors=[Color.red(),Color.blue()];g.locations=[1,0];w.backgroundGradient=g;Script.setWidget(w);`);
  assert.equal(gradient.end.type,'error');assert.match(gradient.end.message,/Gradient locations/);
  const invalid=await run(`new UITable().addRow({});`);assert.equal(invalid.end.type,'error');assert.match(invalid.end.message,/UITableRow/);
});
