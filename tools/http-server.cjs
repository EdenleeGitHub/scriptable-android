// Preview transport mirrors Android's per-hop HTTP API without browser CORS restrictions.
const http=require('node:http'),https=require('node:https'),zlib=require('node:zlib');
const cookies=new Map();
exports.handle=payload=>new Promise((resolve,reject)=>{
  let url;try{url=new URL(payload.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('HTTP / HTTPS URL required');}catch(error){reject(error);return;}
  const headers={...payload.headers};if(!Object.keys(headers).some(key=>key.toLowerCase()==='cookie')&&cookies.has(url.origin))headers.Cookie=cookies.get(url.origin).join('; ');
  let body=payload.body?.base64?Buffer.from(payload.body.base64,'base64'):payload.body==null?null:Buffer.from(String(payload.body));
  if(payload.multipart?.length){const boundary='ScriptableAndroid'+require('node:crypto').randomUUID().replaceAll('-','');const pieces=[];for(const part of payload.multipart){pieces.push(Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="'+part.name.replaceAll('"','%22')+'"'+(part.base64!=null?'; filename="'+part.filename.replaceAll('"','%22')+'"\r\nContent-Type: '+part.mimeType:'')+'\r\n\r\n'));pieces.push(part.base64!=null?Buffer.from(part.base64,'base64'):Buffer.from(part.value));pieces.push(Buffer.from('\r\n'));}pieces.push(Buffer.from('--'+boundary+'--\r\n'));body=Buffer.concat(pieces);for(const key of Object.keys(headers))if(key.toLowerCase()==='content-type')delete headers[key];headers['Content-Type']='multipart/form-data; boundary='+boundary;}
  if(body?.length>16*1024*1024){reject(Error('Request body exceeds 16MB'));return;}
  const method=(payload.method||'GET').toUpperCase();if(body&&!['GET','HEAD'].includes(method))headers['Content-Length']=body.length;
  headers['Accept-Encoding']='gzip';
  const request=(url.protocol==='https:'?https:http).request(url,{method,headers,rejectUnauthorized:!payload.allowInsecureRequest},response=>{
    const setCookie=response.headers['set-cookie'];if(setCookie)cookies.set(url.origin,setCookie.map(value=>value.split(';')[0]));
    let input=response;if(response.headers['content-encoding']==='gzip')input=response.pipe(zlib.createGunzip());const chunks=[];let length=0;
    input.on('data',chunk=>{length+=chunk.length;if(length>16*1024*1024){input.destroy(Error('Response exceeds 16MB'));return;}chunks.push(chunk);});input.on('error',reject);
    input.on('end',()=>{try{const bytes=Buffer.concat(chunks);const type=response.headers['content-type']||'application/octet-stream';const charset=/charset\s*=\s*"?([^;"\s]+)/i.exec(type)?.[1]||'utf-8';let text;try{text=new TextDecoder(charset).decode(bytes);}catch{text=bytes.toString('utf8');}resolve({body:payload.encoding==='base64'?bytes.toString('base64'):text,statusCode:response.statusCode,url:url.href,headers:response.headers,mimeType:type.split(';')[0],textEncodingName:charset,cookies:(cookies.get(url.origin)||[]).map(value=>({name:value.slice(0,value.indexOf('=')),value:value.slice(value.indexOf('=')+1),domain:url.hostname,path:'/',sessionOnly:true})),...(response.statusCode>=300&&response.statusCode<400&&response.headers.location?{redirectURL:new URL(response.headers.location,url).href}:{})});}catch(error){reject(error);}});
  });
  request.setTimeout(Math.min(300000,Math.max(1000,(payload.timeoutInterval||60)*1000)),()=>request.destroy(Error('HTTP request timed out')));request.on('error',reject);if(body&&!['GET','HEAD'].includes(method))request.write(body);request.end();
});
