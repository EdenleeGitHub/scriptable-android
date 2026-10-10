const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'../app/src/main/assets');
const port = Number(process.env.PORT || 4173);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
const transfers=new Map();
const server = http.createServer({maxHeaderSize:2*1024*1024},async(req,res)=>{
  let pathname; try { pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch { res.writeHead(400).end();return; }
  if(pathname==='/native-sync'||pathname==='/native-chunk'||pathname==='/native-request'){
    const send=value=>{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({ok:true,result:value}));};
    try{let url=new URL(req.url,'http://localhost'),action=url.searchParams.get('action'),payload;
      if(pathname==='/native-request'){let chunks=[],length=0;for await(const chunk of req){length+=chunk.length;if(length>24*1024*1024)throw Error('Request exceeds 24MB');chunks.push(chunk);}payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));send(await require('./http-server.cjs').handle(payload));return;}
      if(pathname==='/native-chunk'){const id=url.searchParams.get('id'),phase=url.searchParams.get('phase');if(phase==='begin'){for(const [key,t]of transfers)if(Date.now()-t.touched>120000)transfers.delete(key);if(transfers.size>=8)throw Error('Too many image transfers');const length=Number(url.searchParams.get('length'));if(length<0||length>16*1024*1024)throw Error('Image transfer exceeds 16MB');transfers.set(id,{action,length,data:'',index:0,touched:Date.now()});send(true);return;}const transfer=transfers.get(id);if(!transfer)throw Error('Image transfer expired');if(phase==='cancel'){transfers.delete(id);send(true);return;}if(phase==='append'){const data=url.searchParams.get('data');if(data==null||data.length>100000||Number(url.searchParams.get('index'))!==transfer.index++||transfer.data.length+data.length>transfer.length)throw Error('Invalid image segment');transfer.data+=data;transfer.touched=Date.now();send(true);return;}if(phase!=='execute'||transfer.data.length!==transfer.length)throw Error('Incomplete image transfer');transfers.delete(id);action=transfer.action;payload=JSON.parse(transfer.data);}
      else payload=JSON.parse(url.searchParams.get('payload')||'{}');
      send(await Promise.resolve(require(action?.startsWith('symbols.')?'./symbols-server.cjs':'./graphics-server.cjs').handle(action,payload)));return;
    }catch(error){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({ok:false,error:error.message}));return;}
  }
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(err,bytes)=>{if(err){res.writeHead(404).end('Not found');return;}res.writeHead(200,{'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);});
});
server.listen(port,'127.0.0.1',()=>console.log(`Preview: http://127.0.0.1:${port}`));
module.exports=server;
