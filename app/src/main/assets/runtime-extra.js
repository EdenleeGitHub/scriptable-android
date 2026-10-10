/* Durable Android equivalents for Scriptable networking, notifications, cloud folders and file metadata. */
(() => {
  'use strict';
  const R = self.__runtime, {host,persist,observe} = R;
  const text = (value,label) => { if(typeof value!=='string')throw new TypeError(`${label} must be a string.`);return value; };
  const integer = (value,min,max,label) => {if(!Number.isInteger(value)||value<min||value>max)throw new RangeError(`${label} must be an integer between ${min} and ${max}.`);return value;};
  const track = (target,names) => {for(const name of names){const original=target[name];target[name]=function(...args){return observe(original.apply(this,args));};}};
  const context = R.getcontext();
  const pathOf = input => self.FileManager.local().joinPath('/',text(input,'Path'));
  const entry = path => {path=pathOf(path);const file=R.files[path];if(!file)throw new Error(`File does not exist: ${path}`);return file;};
  const clone = value => JSON.parse(JSON.stringify(value));

  class Notification {
    constructor(){this.identifier=self.UUID.string();this.title='';this.subtitle='';this.body='';this.sound=null;this.badge=null;this.threadIdentifier='';this.userInfo={};this.scriptName='';this.openURL=null;this._actions=[];this._deliveryDate=null;this._nextTriggerDate=null;}
    get actions(){return this._actions.map(action=>({...action}));}
    get deliveryDate(){return this._deliveryDate;}
    get nextTriggerDate(){return this._nextTriggerDate;}
    setTriggerDate(date){if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw new TypeError('Expected a valid Date.');this._triggerDate=date.getTime();delete this._daily;delete this._weekly;}
    setDailyTrigger(hour,minute,repeats=false){this._daily={hour:integer(hour,0,23,'Hour'),minute:integer(minute,0,59,'Minute'),repeats:!!repeats};delete this._weekly;delete this._triggerDate;}
    setWeeklyTrigger(weekday,hour,minute,repeats=false){this._weekly={weekday:integer(weekday,1,7,'Weekday'),hour:integer(hour,0,23,'Hour'),minute:integer(minute,0,59,'Minute'),repeats:!!repeats};delete this._daily;delete this._triggerDate;}
    addAction(title,url,destructive=false){if(this._actions.length>=10)throw new Error('Notifications support at most ten actions.');this._actions.push({title:text(title,'Action title'),url:text(url,'Action URL'),destructive:!!destructive});}
    _payload(){const out={};for(const [key,value]of Object.entries(this))if(!key.startsWith('_'))out[key]=value;return {...out,actions:this.actions,triggerDate:this._triggerDate,daily:this._daily,weekly:this._weekly,scriptId:context.script.id};}
    _apply(record){if(!record||typeof record!=='object')return;for(const[key,value]of Object.entries(record))if(!['actions','deliveryDate','nextTriggerDate','triggerDate','daily','weekly'].includes(key)&&!key.startsWith('_'))this[key]=value;this._actions=Array.isArray(record.actions)?record.actions.map(action=>({...action})):this._actions;this._deliveryDate=record.deliveryDate==null?null:new Date(record.deliveryDate);this._nextTriggerDate=record.nextTriggerDate==null?null:new Date(record.nextTriggerDate);if(record.triggerDate!=null)this._triggerDate=Number(record.triggerDate);if(record.daily)this._daily={...record.daily};if(record.weekly)this._weekly={...record.weekly};}
    async schedule(){if(this.userInfo==null||typeof this.userInfo!=='object'||Array.isArray(this.userInfo))throw new TypeError('Notification.userInfo must be an object.');clone(this.userInfo);this._apply(await host('notification.schedule',this._payload()));}
    async remove(){await Notification.removePending([this.identifier]);}
    static _from(record){const notification=new Notification();notification._apply(record);return notification;}
    static current(){return self.args.notification||null;}
    static async allPending(){return (await host('notification.allPending')||[]).map(Notification._from);}
    static async allDelivered(){return (await host('notification.allDelivered')||[]).map(Notification._from);}
    static async removePending(identifiers){return host('notification.removePending',{identifiers:Notification._ids(identifiers)});}
    static async removeDelivered(identifiers){return host('notification.removeDelivered',{identifiers:Notification._ids(identifiers)});}
    static async removeAllPending(){return host('notification.removeAllPending');}
    static async removeAllDelivered(){return host('notification.removeAllDelivered');}
    static _ids(values){if(!Array.isArray(values)||values.some(value=>typeof value!=='string'))throw new TypeError('Notification identifiers must be an array of strings.');return values;}
    static resetCurrent(){self.args.notification=null;context.args.notification=null;persist('notification.resetCurrent',{});}
    toJSON(){return {...this._payload(),deliveryDate:this.deliveryDate,nextTriggerDate:this.nextTriggerDate};}
  }
  track(Notification.prototype,['schedule','remove']);track(Notification,['allPending','allDelivered','removePending','removeDelivered','removeAllPending','removeAllDelivered']);
  if(self.args.notification&&!(self.args.notification instanceof Notification))self.args.notification=Notification._from(self.args.notification);
  R.register({Notification});

  const Request=self.Request;
  const mimeTypes={txt:'text/plain',js:'text/javascript',json:'application/json',html:'text/html',htm:'text/html',css:'text/css',csv:'text/csv',xml:'application/xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',pdf:'application/pdf',zip:'application/zip',mp3:'audio/mpeg',m4a:'audio/mp4',mp4:'video/mp4'};
  const field = (value,label) => {value=text(value,label);if(/[\r\n\u0000]/.test(value))throw new Error(`${label} cannot contain line breaks.`);return value;};
  Request.prototype.addParameterToMultipart=function(name,value){(this._multipart||=[]).push({name:field(name,'Multipart name'),value:text(value,'Multipart value')});};
  Request.prototype.addFileDataToMultipart=function(data,mimeType,name,filename){if(!(data instanceof self.Data))throw new TypeError('Expected Data.');if(!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mimeType))throw new Error('Invalid MIME type.');(this._multipart||=[]).push({name:field(name,'Multipart name'),filename:field(filename,'Filename'),mimeType,base64:data.toBase64String()});};
  Request.prototype.addFileToMultipart=function(filePath,name,filename){const manager=self.FileManager.local();filePath=pathOf(filePath);return this.addFileDataToMultipart(manager.read(filePath),mimeTypes[manager.fileExtension(filePath).replace(/^\./,'').toLowerCase()]||'application/octet-stream',name,filename==null?manager.fileName(filePath,true):filename);};
  Request.prototype.addImageToMultipart=function(image,name,filename){if(!(image instanceof self.Image))throw new TypeError('Expected Image.');const mime=image.mimeType||'image/png';return this.addFileDataToMultipart(image.data,mime,name,filename==null?(mime==='image/jpeg'?'image.jpg':'image.png'):filename);};
  const origin = value => {const match=/^(https?):\/\/([^/?#]+)(?:[/?#]|$)/i.exec(value);if(!match)throw new Error('Request URL must use HTTP or HTTPS.');let authority=match[2].toLowerCase();if(authority.includes('@'))throw new Error('Embedded URL credentials are not supported.');const protocol=match[1].toLowerCase();authority=authority.replace(protocol==='https'?/:443$/:/:80$/,'');return protocol+'://'+authority;};
  Request.prototype._load=async function(encoding){
    const first=this;let request=this;
    for(let hop=0;hop<=10;hop++){
      origin(request.url);if(!request._multipart?.length&&!(request.body==null||typeof request.body==='string'||request.body instanceof self.Data))throw new TypeError('Request.body must be a string or Data.');
      const reply=await host('request',{url:request.url,method:request.method,headers:request.headers,body:request._multipart?.length?null:request.body,multipart:request._multipart||[],timeoutInterval:request.timeoutInterval,allowInsecureRequest:!!request.allowInsecureRequest,encoding});
      const response={url:reply.url||request.url,statusCode:reply.statusCode,headers:reply.headers||{},mimeType:reply.mimeType||'',textEncodingName:reply.textEncodingName||'utf-8',cookies:reply.cookies||[]};first.response=response;request.response=response;
      if(!reply.redirectURL)return reply.body;
      if(hop===10)throw new Error('Request exceeded ten redirects.');
      const redirect=new Request(reply.redirectURL);redirect.method=String(request.method||'GET').toUpperCase();redirect.headers={...(request.headers||{})};redirect.body=request.body;redirect._multipart=request._multipart?request._multipart.map(part=>({...part})):[];redirect.timeoutInterval=request.timeoutInterval;redirect.allowInsecureRequest=request.allowInsecureRequest;
      if(origin(request.url)!==origin(redirect.url))for(const key of Object.keys(redirect.headers))if(/^(authorization|proxy-authorization|cookie|cookie2)$/i.test(key))delete redirect.headers[key];
      if(reply.statusCode===303&&redirect.method!=='HEAD'||[301,302].includes(reply.statusCode)&&redirect.method==='POST'){redirect.method='GET';redirect.body=null;redirect._multipart=[];for(const key of Object.keys(redirect.headers))if(/^(content-type|content-length|transfer-encoding)$/i.test(key))delete redirect.headers[key];}
      if(typeof first.onRedirect==='function'){const chosen=await first.onRedirect(redirect);if(chosen===null)return reply.body;if(!(chosen instanceof Request))throw new TypeError('onRedirect must return a Request or null.');request=chosen;}else request=redirect;
    }
    throw new Error('Request redirect loop.');
  };

  const FileManager=self.FileManager;
  context.metadata ||= context.fileMetadata || {files:{},bookmarks:{}};context.fileMetadata=context.metadata;context.metadata.files ||= {};context.metadata.bookmarks ||= {};
  const fileMeta = path => {path=pathOf(path);entry(path);return context.metadata.files[path] ||= {tags:[],attributes:{}};};
  FileManager.iCloud=function(){if(!context.cloud?.configured)throw new Error('Android cloud folder is not configured. Run await AndroidCloud.configure() and select a document-provider folder first.');const manager=new FileManager();manager._androidCloud=true;return manager;};
  const documentsDirectory=FileManager.prototype.documentsDirectory;
  FileManager.prototype.documentsDirectory=function(){return this._androidCloud?'/cloud':documentsDirectory.call(this);};
  FileManager.prototype.allTags=function(path){return [...(fileMeta(path).tags||[])];};
  FileManager.prototype.addTag=function(path,tag){path=pathOf(path);tag=text(tag,'Tag');const meta=fileMeta(path);meta.tags ||= [];if(!meta.tags.includes(tag))meta.tags.push(tag);persist('file.metadata',{op:'addTag',path,tag});};
  FileManager.prototype.removeTag=function(path,tag){path=pathOf(path);tag=text(tag,'Tag');const meta=fileMeta(path);meta.tags=(meta.tags||[]).filter(value=>value!==tag);persist('file.metadata',{op:'removeTag',path,tag});};
  FileManager.prototype.readExtendedAttribute=function(path,name){name=text(name,'Attribute name');const attributes=fileMeta(path).attributes||{};return Object.prototype.hasOwnProperty.call(attributes,name)?attributes[name]:null;};
  FileManager.prototype.writeExtendedAttribute=function(path,value,name){path=pathOf(path);name=text(name,'Attribute name');value=text(value,'Attribute value');const meta=fileMeta(path);meta.attributes ||= {};Object.defineProperty(meta.attributes,name,{value,writable:true,configurable:true,enumerable:true});persist('file.metadata',{op:'writeAttribute',path,name,value});};
  FileManager.prototype.removeExtendedAttribute=function(path,name){path=pathOf(path);name=text(name,'Attribute name');const meta=fileMeta(path);if(meta.attributes)delete meta.attributes[name];persist('file.metadata',{op:'removeAttribute',path,name});};
  FileManager.prototype.allExtendedAttributes=function(path){return Object.keys(fileMeta(path).attributes||{});};
  const bookmarkPath=name=>Object.prototype.hasOwnProperty.call(context.metadata.bookmarks,name)?context.metadata.bookmarks[name]:Object.prototype.hasOwnProperty.call(context.cloud?.folders||{},name)?name==='Cloud'?'/cloud':'/bookmarks/'+name:null;
  FileManager.prototype.bookmarkExists=function(name){return bookmarkPath(text(name,'Bookmark name'))!==null;};
  FileManager.prototype.bookmarkedPath=function(name){name=text(name,'Bookmark name');const path=bookmarkPath(name);if(path===null)throw new Error(`File bookmark does not exist: ${name}`);return path;};
  FileManager.prototype.allFileBookmarks=function(){return [...new Set([...Object.keys(context.metadata.bookmarks),...Object.keys(context.cloud?.folders||{})])].map(name=>({name,source:'host'}));};
  FileManager.prototype.getUTI=function(path){const file=entry(path);if(file.type==='directory')return 'public.folder';const ext=this.fileExtension(path).replace(/^\./,'').toLowerCase();return ({txt:'public.plain-text',js:'com.netscape.javascript-source',json:'public.json',html:'public.html',htm:'public.html',css:'public.css',csv:'public.comma-separated-values-text',xml:'public.xml',png:'public.png',jpg:'public.jpeg',jpeg:'public.jpeg',gif:'com.compuserve.gif',svg:'public.svg-image',pdf:'com.adobe.pdf',zip:'public.zip-archive',mp3:'public.mp3',mp4:'public.mpeg-4'})[ext]||'public.data';};
  FileManager.prototype.creationDate=function(path){path=pathOf(path);const file=entry(path),created=context.metadata.files[path]?.createdAt||file.createdAt;return created?new Date(created):null;};
  FileManager.prototype.fileSize=function(path){return this.read(path).getBytes().length/1024;};
  const cloudPath=path=>path==='/cloud'||path.startsWith('/cloud/')?!!context.cloud?.configured:path.startsWith('/bookmarks/')?Object.prototype.hasOwnProperty.call(context.cloud?.folders||{},path.split('/')[2]):false;
  FileManager.prototype.isFileStoredIniCloud=function(path){path=pathOf(path);return this.fileExists(path)&&cloudPath(path);};
  FileManager.prototype.isFileDownloaded=function(path){path=pathOf(path);return this.fileExists(path)&&entry(path).downloaded!==false;};
  FileManager.prototype.downloadFileFromiCloud=async function(path){path=pathOf(path);if(!cloudPath(path))return;if(!context.cloud?.folders||!Object.keys(context.cloud.folders).length)throw new Error('No Android document folder is linked.');const result=await host('cloud.sync',{path});applyCloud(result);if(!this.fileExists(path))throw new Error(`The linked folder does not contain ${path}`);};
  track(FileManager.prototype,['downloadFileFromiCloud']);
  const move=FileManager.prototype.move;
  FileManager.prototype.move=function(source,destination){source=pathOf(source);destination=pathOf(destination);entry(source);if(source===destination)return;if(destination.startsWith(source+'/')||source.startsWith(destination+'/'))throw new Error('Source and destination cannot contain each other.');if(['/documents','/cache','/temporary','/library','/cloud','/bookmarks'].includes(source)||['/documents','/cache','/temporary','/library','/cloud','/bookmarks'].includes(destination))throw new Error('Cannot move or replace a storage root.');if(this.fileExists(destination))this.remove(destination);return move.call(this,source,destination);};
  for(const name of ['writeString','write']){const implementation=FileManager.prototype[name];FileManager.prototype[name]=function(path,...values){path=pathOf(path);const created=this.fileExists(path)?R.files[path].createdAt||context.metadata.files[path]?.createdAt:Date.now();const result=implementation.call(this,path,...values);if(created)R.files[path].createdAt=created;return result;};}
  function applyCloud(result){if(!result)return null;if(result.cloud)context.cloud=result.cloud;if(result.files){for(const path of Object.keys(R.files))if((path==='/cloud'||path.startsWith('/cloud/')||path.startsWith('/bookmarks/'))&&!Object.prototype.hasOwnProperty.call(result.files,path))delete R.files[path];R.updateFiles(result.files);}return result;}
  const AndroidCloud={async configure(bookmarkName='Cloud'){return applyCloud(await host('cloud.configure',{bookmarkName:text(bookmarkName,'Bookmark name')}));},async sync(){return applyCloud(await host('cloud.sync'));},get configured(){return !!context.cloud?.configured;},get folders(){return {...(context.cloud?.folders||{})};}};
  track(AndroidCloud,['configure','sync']);
  const AndroidFiles={addBookmark(name,path){name=text(name,'Bookmark name');path=pathOf(path);entry(path);if(!name||name.length>80||/[\/\\]/.test(name))throw new Error('Invalid bookmark name.');Object.defineProperty(context.metadata.bookmarks,name,{value:path,writable:true,configurable:true,enumerable:true});persist('file.metadata',{op:'bookmark',name,path});},removeBookmark(name){name=text(name,'Bookmark name');delete context.metadata.bookmarks[name];persist('file.metadata',{op:'removeBookmark',name});}};
  R.register({AndroidCloud,AndroidFiles});
})();
