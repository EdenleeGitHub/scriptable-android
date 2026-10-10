'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),base='http://127.0.0.1:4187';
const server=spawn(process.execPath,['tools/preview.cjs'],{cwd:root,env:{...process.env,PORT:'4187'},stdio:'ignore'});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let browser;
(async()=>{
  for(let i=0;i<50;i++){try{if((await fetch(base+'/bridge.js')).ok)break;}catch{}await delay(100);}
  const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';browser=await chromium.launch({headless:true,...(fs.existsSync(chrome)?{executablePath:chrome}:{})});
  const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto(base+'/bridge.js');await page.setContent('<!doctype html><html><body></body></html>');await page.addScriptTag({url:base+'/bridge.js'});await page.addScriptTag({url:base+'/presentation-browser.js'});await page.evaluate(()=>Host.ready);
  const evaluated=await page.evaluate(async()=>{
    await PresentationBrowser.call('webview.load',{webviewId:'html',mode:'html',html:'<h1>Hello isolated</h1><script>window.answer=42</script>'},{runId:'webtest'});
    const answer=await PresentationBrowser.call('webview.evaluate',{webviewId:'html',javaScript:'window.answer'});
    const completion=await PresentationBrowser.call('webview.evaluate',{webviewId:'html',javaScript:'setTimeout(()=>completion({answer:answer+1}),30)',useCallback:true});
    const hostType=await PresentationBrowser.call('webview.evaluate',{webviewId:'html',javaScript:'typeof Android+":"+typeof Host'});
    return {answer,completion,hostType};
  });
  assert.deepEqual(evaluated,{answer:42,completion:{answer:43},hostType:'undefined:undefined'});
  await page.evaluate(()=>{window.presented=false;PresentationBrowser.call('webview.present',{webviewId:'html',fullscreen:true},{runId:'webtest'}).then(()=>window.presented=true);});
  await page.getByRole('button',{name:'完成',exact:true}).click();await page.waitForFunction(()=>window.presented);
  await page.evaluate(()=>PresentationBrowser.call('webview.close',{webviewId:'html'}));assert.equal(await page.locator('iframe').count(),0);
  await page.evaluate(()=>{
    window.tableEvents=[];window.tableDone=false;PresentationBrowser.call('table.present',{tableId:'test',showSeparators:true,rows:[{rowId:'row',height:72,dismissOnSelect:false,selectable:true,cells:[{type:'text',cellId:'text',title:'标题',subtitle:'副标题',widthWeight:3},{type:'button',cellId:'button',title:'更新',tappable:true,dismissOnTap:false}]}]},{runId:'tabletest',onEvent:event=>window.tableEvents.push(event)}).then(()=>window.tableDone=true);
  });
  await page.getByText('标题',{exact:true}).click();await page.getByText('更新',{exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>tableEvents.map(event=>event.type)),['select','tap']);
  await page.evaluate(()=>PresentationBrowser.call('table.reload',{tableId:'test',rows:[{rowId:'new',height:60,cells:[{type:'text',title:'替换后的行'}]}]}));await page.getByText('替换后的行',{exact:true}).waitFor();
  await page.evaluate(()=>PresentationBrowser.cancel('tabletest'));await page.waitForFunction(()=>window.tableDone);assert.equal(await page.locator('.presentation-browser-overlay').count(),0);
  console.log('PASS: sandboxed HTML evaluation, completion, no privileged bridge, WebView dismissal, table callbacks/reload/cancel');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.kill();});
