/* Native transport and terminable script worker. No user source is evaluated in the UI. */
(() => {
  'use strict';
  const native = typeof window.Android?.callSync === 'function';
  let nextId = 0;
  const pending = new Map();
  const nativeEventListeners = new Map();
  window.__nativeEvent = (id,event)=>nativeEventListeners.get(String(id))?.listener(event);
  window.__nativeResolve = (id, ok, result) => {
    const item = pending.get(String(id));
    if (!item) return;
    pending.delete(String(id)); if(!nativeEventListeners.get(String(id))?.runId)nativeEventListeners.delete(String(id)); clearTimeout(item.timeout);
    if (ok) item.resolve(result); else item.reject(new Error(typeof result === 'string' ? result : result?.message || '安卓操作失败'));
  };
  const storageKey = 'scriptable-android-preview-v1';
  const read = () => { try { return JSON.parse(localStorage.getItem(storageKey)) || {scripts: [], settings: {}, files: {}, keychain: {}}; } catch { throw new Error('本地数据损坏，请先备份浏览器数据。'); } };
  const write = state => localStorage.setItem(storageKey, JSON.stringify(state));
  const roots = ['/documents', '/cache', '/temporary', '/library','/cloud','/bookmarks'];
  function safePath(path) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\u0000') || path.includes('\\') || path.split('/').includes('..')) throw new Error('文件路径必须位于应用目录中');
    const normalized = path.replace(/\/+$/,'') || '/';
    if (!roots.some(root => normalized === root || normalized.startsWith(root + '/'))) throw new Error('文件路径必须位于应用目录中');
    return normalized;
  }
  function browserSync(action, payload) {
    const state = read();
    if (action === 'bootstrap') {
      for (const root of roots) state.files[root] ||= {type:'directory'};
      write(state);
      return {...state,fileMetadata:state.fileMetadata||{files:{},bookmarks:{}},nativeRuntime:false,clipboard:null, device:{name:'浏览器预览',model:'浏览器',systemName:'Preview',systemVersion:navigator.userAgent,screenSize:{width:innerWidth,height:innerHeight},screenScale:devicePixelRatio,batteryLevel:-1,isCharging:false,locale:navigator.language,isDark:matchMedia('(prefers-color-scheme: dark)').matches}};
    }
    if (action === 'repo.list') return state.scripts;
    if (action === 'repo.save') {
      if (!payload.id || !String(payload.name || '').trim() || typeof payload.code !== 'string') throw new Error('脚本名称和代码不能为空');
      const script = {...payload,updatedAt:Date.now()};
      const index = state.scripts.findIndex(x => x.id === payload.id);
      if (index < 0) state.scripts.push(script); else state.scripts[index] = script;
      write(state); return script;
    }
    if (action === 'repo.delete') { state.scripts = state.scripts.filter(x => x.id !== payload.id); write(state); return true; }
    if (action === 'settings.get') return state.settings;
    if (action === 'settings.set') { state.settings = {...state.settings,...payload}; write(state); return state.settings; }
    throw new Error('未支持的本地操作：' + action);
  }
  async function browserCall(action,payload,options={}) {
    if(window.PresentationBrowser?.handles(action))return PresentationBrowser.call(action,payload,options);
    if (action === 'ui.ready'||action==='runtime.start') return true;
    if (action === 'ui.theme') return true;
    if (action === 'runtime.cancel'||action==='runtime.finish') { window.PresentationBrowser?.cancel(payload.runId);for(const overlay of document.querySelectorAll('.native-alert-overlay'))overlay.remove();if(action==='runtime.cancel')speechSynthesis.cancel(); return true; }
    if (['bootstrap','repo.list','repo.save','repo.delete','settings.get','settings.set'].includes(action)) return browserSync(action,payload);
    const state = read();
    if (action === 'file.op') {
      const path = safePath(payload.path);
      const dest = payload.destination ? safePath(payload.destination) : null;
      if (payload.op === 'writeString' || payload.op === 'write') {
        const parent = path.substring(0,path.lastIndexOf('/'));
        if (state.files[parent]?.type !== 'directory') throw new Error('父文件夹不存在');
        state.files[path] = {type:'file',text:payload.text,base64:payload.base64,modifiedAt:Date.now()};
      } else if (payload.op === 'createDirectory') {
        let built = ''; for (const part of path.split('/').filter(Boolean)) { built += '/' + part; if (state.files[built]?.type === 'file') throw new Error('路径是一个文件'); state.files[built] = {type:'directory'}; }
      } else if (payload.op === 'remove') {
        if (roots.includes(path)) throw new Error('不能删除根目录');
        if (!state.files[path]) throw new Error('文件不存在');
        for (const key of Object.keys(state.files)) if (key === path || key.startsWith(path+'/')) delete state.files[key];
      } else if (payload.op === 'copy' || payload.op === 'move') {
        if (!state.files[path] || !dest || state.files[dest] || roots.includes(path) || dest.startsWith(path+'/')) throw new Error('无法移动或复制这个路径');
        for (const key of Object.keys(state.files)) if (key === path || key.startsWith(path+'/')) { state.files[dest + key.slice(path.length)] = {...state.files[key]}; if (payload.op === 'move') delete state.files[key]; }
      } else throw new Error('未支持的文件操作');
      write(state); return true;
    }
    if(action==='file.metadata'){
      const metadata=state.fileMetadata||={files:{},bookmarks:{}};
      if(payload.op==='bookmark'){const path=safePath(payload.path);if(!state.files[path])throw new Error('书签文件不存在');Object.defineProperty(metadata.bookmarks,payload.name,{value:path,enumerable:true,configurable:true,writable:true});}
      else if(payload.op==='removeBookmark')delete metadata.bookmarks[payload.name];
      else{const path=safePath(payload.path);if(!state.files[path])throw new Error('文件不存在');const item=metadata.files[path]||={tags:[],attributes:{}};
        if(payload.op==='addTag'){if(!item.tags.includes(payload.tag))item.tags.push(payload.tag);}
        else if(payload.op==='removeTag')item.tags=item.tags.filter(tag=>tag!==payload.tag);
        else if(payload.op==='writeAttribute')Object.defineProperty(item.attributes,payload.name,{value:payload.value,enumerable:true,configurable:true,writable:true});
        else if(payload.op==='removeAttribute')delete item.attributes[payload.name];else throw new Error('未知文件元数据操作');}
      write(state);return true;
    }
    if (action === 'keychain.op') {
      throw new Error('安全存储需要安卓安装版，浏览器预览不保存密钥');
    }
    if (action === 'request') {
      const reply=await fetch('native-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const value=await reply.json();if(!value.ok)throw new Error(value.error || '网络请求失败');return value.result;
    }
    if (action === 'clipboard.read') return navigator.clipboard.readText();
    if (action === 'clipboard.write') { await navigator.clipboard.writeText(payload.text || ''); return true; }
    if (action === 'widget.save') { state.widget = payload; write(state); return true; }
    if (action === 'safari.open') { const url = new URL(payload.url); if(!['https:','http:'].includes(url.protocol)) throw new Error('只支持网页链接'); window.open(url.href,'_blank','noopener'); return true; }
    if (action === 'share' && navigator.share) { await navigator.share({text:payload.text}); return true; }
    if (action === 'speech') { const speech = new SpeechSynthesisUtterance(payload.text); if(payload.language) speech.lang=payload.language; speechSynthesis.speak(speech); return true; }
    if (action === 'repo.export') {
      const script = state.scripts.find(s=>s.id === payload.id); if(!script) throw new Error('脚本不存在');
      const url = URL.createObjectURL(new Blob([script.code],{type:'application/javascript'}));
      const a=document.createElement('a'); a.href=url; a.download=script.name.replace(/[\\/:*?"<>|]/g,'_')+'.js'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); return true;
    }
    if (action === 'repo.import') return new Promise((resolve,reject)=>{
      const input=document.createElement('input'); input.type='file'; input.accept='.js,.txt,application/javascript,text/plain';
      input.onchange=async()=>{try {const file=input.files[0]; if(!file) return resolve(null); if(file.size>1024*1024) throw new Error('脚本不能超过 1MB'); resolve({id:crypto.randomUUID(),name:file.name.replace(/\.(js|txt)$/i,''),code:await file.text(),color:'#5450d6',icon:'code',updatedAt:Date.now()});}catch(e){reject(e);}};
      input.addEventListener('cancel',()=>resolve(null),{once:true}); input.click();
    });
    if (action === 'alert') return new Promise(resolve=>{
      const overlay=document.createElement('div'); overlay.className='native-alert-overlay';
      const dialog=document.createElement('form'); dialog.className='native-alert'; dialog.setAttribute('role','dialog'); dialog.setAttribute('aria-modal','true');
      const title=document.createElement('h2'); title.textContent=payload.title || '提示'; dialog.append(title);
      if(payload.message){ const p=document.createElement('p');p.textContent=payload.message;dialog.append(p); }
      const inputs=(payload.textFields || []).map(field=>{const input=document.createElement('input');input.placeholder=field.placeholder || '';input.value=field.value || '';input.type=field.secure?'password':'text';dialog.append(input);return input;});
      const finish=index=>{overlay.remove();resolve({index,values:inputs.map(x=>x.value)});};
      (payload.actions || []).forEach((action,index)=>{const button=document.createElement('button');button.type='button';button.textContent=action.title;button.onclick=()=>finish(index);dialog.append(button);});
      const cancel=document.createElement('button');cancel.type='button';cancel.textContent=payload.cancel || '取消';cancel.onclick=()=>finish(-1);dialog.append(cancel);
      dialog.onsubmit=e=>{e.preventDefault();finish((payload.actions || []).length?0:-1);};overlay.append(dialog);document.body.append(overlay);(inputs[0]||dialog.querySelector('button')).focus();
    });
    throw new Error('此功能需要安装安卓 APK：'+action);
  }
  window.Host = {
    isNative:native,
    ready:native ? Promise.resolve() : (async()=>{ const state=read();if(!localStorage.getItem(storageKey)){const response=await fetch('examples.json');if(!response.ok)throw new Error('示例加载失败');state.scripts=(await response.json()).slice(0,4).map(x=>({...x,updatedAt:Date.now()}));for(const root of roots)state.files[root]={type:'directory'};write(state);} })(),
    sync(action,payload={}) { if(!native)return browserSync(action,payload); const reply=JSON.parse(Android.callSync(action,JSON.stringify(payload))); if(!reply.ok)throw new Error(reply.error || '安卓操作失败'); return reply.result; },
    call(action,payload={},options={}) {
      if(!native)return browserCall(action,payload,options);
      return new Promise((resolve,reject)=>{ const id=String(++nextId); if(options.onEvent)nativeEventListeners.set(id,{listener:options.onEvent,runId:options.runId}); const timeout=setTimeout(()=>{pending.delete(id);nativeEventListeners.delete(id);reject(new Error('操作等待超时：'+action));},['alert','repo.import','repo.export','table.present','webview.present'].includes(action)?1800000:130000);pending.set(id,{resolve,reject,timeout});try{Android.call(JSON.stringify({id,action,payload,runId:options.runId}));}catch(e){pending.delete(id);nativeEventListeners.delete(id);clearTimeout(timeout);reject(e);} });
    }
  };
  let current = null;
  window.ScriptRunner = {
    isRunning:()=>!!current,
    run(script, callbacks={}, args={}) {
      if(current) this.stop();
      return new Promise((resolve,reject)=>{
        let snapshot;
        try { snapshot=Host.sync('bootstrap'); } catch(e){ callbacks.onState?.('error',e.message);reject(e);return; }
        const worker = new Worker('runtime.js');
        const run={id:crypto.randomUUID(),worker,resolve,reject,callbacks,started:Date.now()};current=run;
        const finish=(state,value)=>{
          if(current!==run)return;
          current=null;clearTimeout(run.timeout);worker.terminate();
          Host.call(state==='done'?'runtime.finish':'runtime.cancel',{runId:run.id,output:state==='done'?value:undefined,error:state==='error'?value.message:state==='stopped'?'运行已停止':undefined}).catch(()=>{});
          for(const [id,item] of nativeEventListeners)if(item.runId===run.id)nativeEventListeners.delete(id);
          callbacks.onState?.(state,state==='error'?value.message:state==='stopped'?'已停止':undefined);
          if(state==='error')reject(value);else resolve(value);
        };
        run.finish=finish;
        run.timeout=setTimeout(()=>finish('error',new Error('脚本已超过运行时限，运行已停止。')),args.config?.runsInWidget?60000:1800000);
        worker.onmessage=async event=>{
          if(current!==run)return;
          const message=event.data;
          if(message.type==='log')callbacks.onLog?.(message.level,message.values);
          else if(message.type==='widget')callbacks.onWidget?.(message.tree,{family:message.family});
          else if(message.type==='preview')callbacks.onPreview?.(message.value,message.format,{fullscreen:!!message.fullscreen});
          else if(message.type==='host'){
            try { const result=await Host.call(message.action,message.payload,{runId:run.id,onEvent:event=>{if(current===run)worker.postMessage({type:'hostEvent',id:message.id,event});}}); if(current===run)worker.postMessage({type:'hostResult',id:message.id,ok:true,result}); }
            catch(e){if(current===run)worker.postMessage({type:'hostResult',id:message.id,ok:false,error:e.message});}
          } else if(message.type==='done')finish('done',message.result);
          else if(message.type==='error'){ const error=new Error(message.message);error.stack=message.stack || error.stack;finish('error',error); }
        };
        worker.onerror=event=>{ event.preventDefault();finish('error',new Error(event.message || '脚本运行器发生错误')); };
        callbacks.onState?.('running');
        Host.call('runtime.start',{runId:run.id,queryParameters:snapshot.args?.queryParameters||{}}).catch(()=>{});
        worker.postMessage({type:'run',code:script.code,context:{...snapshot,script,args:{...(snapshot.args||{}),...args},config:{runsInApp:true,runsInWidget:false,runsWithSiri:false,runsInActionExtension:false,widgetFamily:'medium',...(snapshot.launchConfig||{}),...args.config}}});
      });
    },
    stop(){const run=current;if(run)run.finish('stopped',null);}
  };
})();
