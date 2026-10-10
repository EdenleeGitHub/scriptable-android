/* Browser preview adapter. Script HTML executes only in opaque-origin sandboxed frames. */
(() => {
  'use strict';
  const views = new Map(), tables = new Map(), evaluations = new Map();
  const timeout = (operation, ms, message) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(message)), ms); operation.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); }); });
  function style(element, properties) { Object.assign(element.style, properties); return element; }
  function frame() { const element = document.createElement('iframe'); element.setAttribute('sandbox', 'allow-scripts allow-forms'); element.referrerPolicy = 'no-referrer'; element.title = '脚本网页'; style(element, { border:'0', width:'100%', height:'100%', display:'none' }); document.body.append(element); return element; }
  function browser(id, options) { let view = views.get(id); if (!view) { if (views.size >= 8) throw new Error('最多可创建八个网页视图'); view = {id,frame:frame(),channel:crypto.randomUUID(),options,runId:options.runId,waiters:[],navigations:new Map(),injected:false}; views.set(id,view); } return view; }
  function present(content, fullscreen, finish) {
    const overlay = style(document.createElement('div'), { position:'fixed', inset:'0', zIndex:'10000', background:'#0008', display:'flex', alignItems:fullscreen?'stretch':'flex-end', justifyContent:'center', padding:fullscreen?'0':'14px' });
    overlay.className = 'presentation-browser-overlay';
    const panel = style(document.createElement('div'), {display:'flex',flexDirection:'column',width:'100%',maxWidth:fullscreen?'none':'760px',height:fullscreen?'100%':'88%',borderRadius:fullscreen?'0':'16px',overflow:'hidden',background:'#fff',color:'#202b40'});
    const toolbar = style(document.createElement('div'), {display:'flex',justifyContent:'flex-end',padding:'10px 16px',borderBottom:'1px solid #e0e5ed'});
    const done = style(document.createElement('button'), {border:'0',borderRadius:'8px',padding:'8px 18px',background:'#5450d6',color:'#fff',cursor:'pointer'}); done.textContent='完成'; toolbar.append(done);
    style(content,{display:'block',flex:'1',minHeight:'0'});panel.append(toolbar,content);overlay.append(panel);document.body.append(overlay);
    let closed = false; const close = () => { if (closed) return; closed=true; content.remove();overlay.remove();window.removeEventListener('keydown',escape);finish(); };
    const escape = event => { if(event.key==='Escape')close(); };window.addEventListener('keydown',escape);done.onclick=close;done.focus(); return close;
  }
  function injection(view) {
    const channel = JSON.stringify(view.channel);
    // No Host, Android, storage or application objects are injected into script pages.
    return `<script>(function(){const channel=${channel};const send=(value)=>parent.postMessage(Object.assign({channel},value),'*');window.log=(...values)=>send({type:'webLog',values});window.logError=(...values)=>send({type:'webLog',error:true,values});window.addEventListener('message',event=>{const m=event.data;if(event.source!==parent||m.channel!==channel||m.type!=='evaluate')return;const respond=(ok,value)=>{try{send({type:'evaluation',id:m.id,ok,result:ok?JSON.parse(JSON.stringify(value===undefined?null:value)):String(value)})}catch(error){send({type:'evaluation',id:m.id,ok:false,result:String(error)})}};if(m.useCallback)window.completion=value=>respond(true,value);try{const value=(0,eval)(m.code);if(!m.useCallback)respond(true,value)}catch(error){respond(false,error)}});document.addEventListener('click',event=>{const anchor=event.target.closest&&event.target.closest('a[href]');if(!anchor)return;event.preventDefault();send({type:'navigation',url:anchor.href})},true)})()<\/script>`;
  }
  function localResources(html, path) {
    const files = window.Host.sync('bootstrap').files || {}, base = path.slice(0,path.lastIndexOf('/')+1), documentHTML = new DOMParser().parseFromString(html,'text/html');
    for(const node of documentHTML.querySelectorAll('img[src],script[src],link[href],source[src]')) {
      const attribute=node.hasAttribute('src')?'src':'href', original=node.getAttribute(attribute);
      if(!original || /^[a-z][a-z0-9+.-]*:/i.test(original))continue;
      const segments=(original.startsWith('/')?original:base+original).split('/'), parts=[];for(const part of segments){if(part==='..')parts.pop();else if(part&&part!=='.')parts.push(part);}
      const entry=files['/'+parts.join('/')];if(!entry || entry.type!=='file')continue;
      const extension=original.split('.').pop().toLowerCase(),mime=({css:'text/css',js:'text/javascript',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',svg:'image/svg+xml',webp:'image/webp',gif:'image/gif'})[extension]||'application/octet-stream';
      const data=entry.base64 || btoa(unescape(encodeURIComponent(entry.text||'')));node.setAttribute(attribute,`data:${mime};base64,${data}`);
    }
    return documentHTML.documentElement.outerHTML;
  }
  async function load(view,payload) {
    view.intercept=!!payload.interceptNavigation;let html;
    if(payload.mode==='file') {
      const path=payload.path.replace(/^file:\/\//,''),entry=window.Host.sync('bootstrap').files[path];if(!entry || entry.type!=='file')throw new Error('私有文件不存在');
      if(/\.(png|jpe?g|gif|webp)$/i.test(path))html=`<img style="max-width:100%" src="data:image/${path.split('.').pop()};base64,${entry.base64 || ''}">`;
      else html=localResources(entry.text===undefined?new TextDecoder().decode(Uint8Array.from(atob(entry.base64||''),char=>char.charCodeAt(0))):entry.text,path);
    } else if(payload.mode==='html')html=payload.html;
    else {
      const url=new URL(payload.url);if(!['http:','https:'].includes(url.protocol))throw new Error('网页只支持 HTTP/HTTPS');
      // CORS can prevent source inspection in browser preview. Native Android WebView has full evaluation.
      try { const response=await timeout(fetch(url),15000,'网页请求超时'); if(!response.ok)throw new Error('HTTP '+response.status);html=await response.text();payload={...payload,baseURL:response.url||url.href}; }
      catch { view.injected=false;view.frame.removeAttribute('srcdoc');view.frame.src=url.href;return waitLoad(view); }
    }
    if(typeof html!=='string' || html.length>4*1024*1024)throw new Error('网页 HTML 无效或超过 4 MB');
    const base=payload.baseURL?`<base href="${String(payload.baseURL).replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">`:'';
    view.injected=true;view.frame.removeAttribute('src'); const operation=waitLoad(view);view.frame.srcdoc=injection(view)+base+html;return operation;
  }
  function waitLoad(view) { return timeout(new Promise((resolve,reject)=>{view.waiters.push({resolve,reject});view.frame.onload=()=>{for(const item of view.waiters.splice(0))item.resolve(null);};view.frame.onerror=()=>{for(const item of view.waiters.splice(0))item.reject(new Error('网页加载失败'));};}),60000,'网页加载超时'); }
  function destroy(view) { if(view.close)view.close();view.frame.remove();views.delete(view.id);for(const [key,item] of evaluations)if(item.view===view){item.reject(new Error('网页已关闭'));evaluations.delete(key);}for(const item of view.waiters.splice(0))item.reject(new Error('网页已关闭')); }
  function safeImage(value) { return typeof value==='string'&&/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/i.test(value)?value:null; }
  function renderTable(state) {
    state.content.replaceChildren();const payload=state.payload;if((payload.rows||[]).length>500)throw new Error('表格最多支持 500 行');
    (payload.rows||[]).forEach((row,index)=>{
      const element=style(document.createElement('div'),{display:'flex',alignItems:'center',gap:(row.cellSpacing||0)+'px',padding:'6px 12px',height:Math.max(24,row.height||44)+'px',boxSizing:'border-box',background:row.backgroundColor||(row.isHeader?'#f0f2f6':'#fff'),borderBottom:payload.showSeparators?'1px solid #e0e5ed':'0',fontWeight:row.isHeader?'600':'normal'});
      const selected=cell=>{state.options.onEvent?.({type:cell?'tap':'select',tableId:state.id,rowId:row.rowId,cellId:cell?.cellId,index});if(cell?cell.dismissOnTap:row.dismissOnSelect!==false)setTimeout(()=>state.close?.(),80);};
      for(const cell of (row.cells||[]).slice(0,50)) {
        let item;
        if(cell.type==='image') { item=document.createElement('img');item.alt='脚本图片';const url=safeImage(cell.image)||(cell.imageURL&&/^https?:\/\//i.test(cell.imageURL)?cell.imageURL:null);if(url)item.src=url;style(item,{height:'100%',objectFit:'contain'}); }
        else { item=document.createElement('div');const title=document.createElement('div');title.textContent=cell.title||'';style(title,{color:cell.titleColor||(cell.type==='button'?'#007aff':'#202b40'),fontSize:(cell.titleFont?.size||17)+'px',fontWeight:cell.titleFont?.weight||(row.isHeader?'600':'normal'),fontFamily:cell.titleFont?.family||'system-ui'});item.append(title);if(cell.subtitle){const subtitle=document.createElement('div');subtitle.textContent=cell.subtitle;style(subtitle,{color:cell.subtitleColor||'#61718a',fontSize:(cell.subtitleFont?.size||13)+'px',fontFamily:cell.subtitleFont?.family||'system-ui'});item.append(subtitle);} }
        style(item,{flex:String(Math.max(.01,cell.widthWeight||1))+' 1 0',minWidth:'0',textAlign:cell.alignment||'left',overflow:'hidden'});
        if(cell.tappable){item.onclick=event=>{event.stopPropagation();selected(cell);};item.style.cursor='pointer';item.setAttribute('role','button');item.tabIndex=0;item.onkeydown=event=>{if(event.key==='Enter')selected(cell);};}element.append(item);
      }
      if(row.selectable){element.onclick=()=>selected(null);element.style.cursor='pointer';element.setAttribute('role','button');element.tabIndex=0;element.onkeydown=event=>{if(event.key==='Enter')selected(null);};}state.content.append(element);
    });
  }
  window.addEventListener('message',event=>{
    const view=[...views.values()].find(item=>item.frame.contentWindow===event.source&&item.channel===event.data?.channel);if(!view)return;const message=event.data;
    if(message.type==='evaluation'){const operation=evaluations.get(message.id);if(!operation || operation.view!==view)return;evaluations.delete(message.id);message.ok?operation.resolve(message.result):operation.reject(new Error(message.result));}
    else if(message.type==='webLog')view.options.onEvent?.({type:'webLog',values:message.values,error:message.error});
    else if(message.type==='navigation') {const key=crypto.randomUUID();view.navigations.set(key,message.url);if(view.intercept)view.options.onEvent?.({type:'navigation',webviewId:view.id,navigationId:key,url:message.url,method:'GET',headers:{}});else load(view,{mode:'url',url:message.url}).catch(error=>view.options.onEvent?.({type:'webLog',error:true,values:[error.message]}));}
  });
  window.PresentationBrowser={
    handles(action){return action.startsWith('webview.')||['table.present','table.reload','safari.present','callback.open','url.open'].includes(action);},
    async call(action,payload,options={}) {
      if(action==='table.present'){if(tables.has(payload.tableId))throw new Error('表格已经显示');const state={id:payload.tableId,payload,options,runId:options.runId,content:style(document.createElement('div'),{overflow:'auto'})};tables.set(state.id,state);renderTable(state);return new Promise(resolve=>{state.close=present(state.content,payload.fullscreen,()=>{tables.delete(state.id);resolve(null);});});}
      if(action==='table.reload'){const state=tables.get(payload.tableId);if(state){state.payload=payload;renderTable(state);}return null;}
      if(action==='safari.present'){const view=browser(crypto.randomUUID(),options);await load(view,{mode:'url',url:payload.url});return new Promise(resolve=>{view.close=present(view.frame,payload.fullscreen,()=>{view.close=null;destroy(view);resolve(null);});});}
      if(action==='callback.open')throw new Error('跨应用 x-callback-url 返回需要安卓安装版');
      if(action==='url.open'){const url=new URL(payload.url);if(['javascript:','file:','data:','content:','intent:'].includes(url.protocol))throw new Error('不支持此链接');window.open(url.href,'_blank','noopener');return true;}
      const view=action==='webview.load'?browser(payload.webviewId,options):views.get(payload.webviewId);if(!view){if(action==='webview.close')return null;throw new Error('请先载入网页内容');}view.options=options;
      if(action==='webview.load')return load(view,payload);
      if(action==='webview.wait')return waitLoad(view);
      if(action==='webview.close'){destroy(view);return null;}
      if(action==='webview.present'){if(view.close)throw new Error('网页已经显示');return new Promise(resolve=>{view.close=present(view.frame,payload.fullscreen,()=>{view.close=null;view.frame.style.display='none';document.body.append(view.frame);resolve(null);});});}
      if(action==='webview.navigate'){const url=view.navigations.get(payload.navigationId);view.navigations.delete(payload.navigationId);if(payload.allow&&url)await load(view,{mode:'url',url,interceptNavigation:view.intercept});return null;}
      if(action==='webview.evaluate'){if(!view.injected)throw new Error('此网页限制浏览器跨域读取；安卓安装版支持网页 JavaScript 求值');const id=crypto.randomUUID();return timeout(new Promise((resolve,reject)=>{evaluations.set(id,{resolve,reject,view});view.frame.contentWindow.postMessage({type:'evaluate',channel:view.channel,id,code:payload.javaScript,useCallback:payload.useCallback},'*');}),120000,'网页 JavaScript 未完成').finally(()=>evaluations.delete(id));}
      throw new Error('未知网页操作：'+action);
    },
    cancel(runId){for(const state of [...tables.values()])if(!runId||state.runId===runId)state.close?.();for(const view of [...views.values()])if(!runId||view.runId===runId)destroy(view);},
    close(){this.cancel();}
  };
})();
