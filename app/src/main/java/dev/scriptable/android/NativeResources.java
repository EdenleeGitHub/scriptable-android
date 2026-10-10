package dev.scriptable.android;

import android.content.Context;
import android.net.Uri;
import android.webkit.*;
import org.json.*;
import java.io.*;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** Same-origin packaged resources and token-bound synchronous Worker APIs. */
final class NativeResources {
    static final String ORIGIN="https://appassets.androidplatform.net";
    private static final Map<String,WeakReference<Context>> TOKENS=new ConcurrentHashMap<>();
    private static final Map<String,Chunk> CHUNKS=new ConcurrentHashMap<>();
    private static final class Chunk{final String action;final int length;final StringBuilder data=new StringBuilder();int index;long touched=System.currentTimeMillis();Chunk(String a,int l){action=a;length=l;}}
    private static Context app;
    static synchronized String register(Context c){app=c.getApplicationContext();String token=UUID.randomUUID().toString();TOKENS.put(token,new WeakReference<>(c));ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient(){@Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest r){return isLocal(r.getUrl())?response(r.getUrl()):null;}});return token;}
    static void unregister(String token){TOKENS.remove(token);CHUNKS.keySet().removeIf(key->key.startsWith(token+":"));}
    static boolean isLocal(Uri u){return "https".equals(u.getScheme())&&"appassets.androidplatform.net".equals(u.getHost())&&(u.getPort()==-1||u.getPort()==443)&&u.getUserInfo()==null;}
    static WebResourceResponse response(Uri uri){
        if(!isLocal(uri))return reply(403,"Forbidden","text/plain","External resource rejected");
        if("/native-sync".equals(uri.getPath())||"/native-chunk".equals(uri.getPath())){
            try{
                WeakReference<Context> ref=TOKENS.get(uri.getQueryParameter("token"));Context c=ref==null?null:ref.get();if(c==null)return reply(403,"Forbidden","application/json","{\"ok\":false,\"error\":\"Native session expired\"}");
                String action=uri.getQueryParameter("action"),raw=uri.getQueryParameter("payload");Object value;
                if("/native-chunk".equals(uri.getPath())){
                    String id=uri.getQueryParameter("id"),phase=uri.getQueryParameter("phase");if(id==null||!id.matches("[A-Za-z0-9_-]{1,80}"))throw new Exception("Invalid native chunk identifier");String key=uri.getQueryParameter("token")+":"+id;
                    if("begin".equals(phase)){CHUNKS.entrySet().removeIf(entry->System.currentTimeMillis()-entry.getValue().touched>120000);if(CHUNKS.size()>=8)throw new Exception("Too many native image transfers");int length=Integer.parseInt(uri.getQueryParameter("length"));if(length<0||length>16*1024*1024)throw new Exception("Native transfer exceeds 16MB");CHUNKS.put(key,new Chunk(action,length));return ok(true);}
                    Chunk chunk=CHUNKS.get(key);if(chunk==null)throw new Exception("Native transfer expired");
                    synchronized(chunk){if("cancel".equals(phase)){CHUNKS.remove(key);return ok(true);}if("append".equals(phase)){String data=uri.getQueryParameter("data");if(data==null||data.length()>100000||Integer.parseInt(uri.getQueryParameter("index"))!=chunk.index++||chunk.data.length()+data.length()>chunk.length)throw new Exception("Invalid native transfer segment");chunk.data.append(data);chunk.touched=System.currentTimeMillis();return ok(true);}if(!"execute".equals(phase))throw new Exception("Invalid transfer phase");CHUNKS.remove(key);if(chunk.data.length()!=chunk.length)throw new Exception("Native image transfer is incomplete");raw=chunk.data.toString();action=chunk.action;}
                }
                if(raw==null||raw.length()>16*1024*1024)throw new Exception("Native payload is too large");JSONObject payload=new JSONObject(raw);
                if(action!=null&&(action.startsWith("graphics.")||action.startsWith("image.")||action.startsWith("date.")))value=NativeGraphics.handle(action,payload);
                else if(action!=null&&action.startsWith("symbols."))value=NativeSymbols.handle(c,action,payload);
                else if(action!=null&&(action.startsWith("device.")||action.startsWith("clipboard.")))value=AndroidServices.handleSync(c,action,payload);
                else throw new Exception("Unknown synchronous native API");
                return ok(value);
            }catch(Exception error){try{return reply(200,"OK","application/json",new JSONObject().put("ok",false).put("error",String.valueOf(error.getMessage())).toString());}catch(Exception ignored){return reply(500,"Error","text/plain","Native API error");}}
        }
        String path=uri.getPath();if(path==null||!path.startsWith("/assets/"))return reply(404,"Not Found","text/plain","Not found");String asset=path.substring(8);if(asset.isEmpty()||asset.contains("..")||asset.contains("\\"))return reply(403,"Forbidden","text/plain","Invalid path");
        try{String mime=mime(asset);WebResourceResponse result=new WebResourceResponse(mime,mime.startsWith("image/")?null:"UTF-8",app.getAssets().open(asset));Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-cache");headers.put("X-Content-Type-Options","nosniff");
            if(asset.endsWith(".html"))headers.put("Content-Security-Policy","default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' data: blob:; object-src 'none'; base-uri 'none'");
            result.setResponseHeaders(headers);return result;
        }catch(Exception error){return reply(404,"Not Found","text/plain","Asset missing");}
    }
    private static WebResourceResponse ok(Object value)throws Exception{return reply(200,"OK","application/json",new JSONObject().put("ok",true).put("result",value==null?JSONObject.NULL:value).toString());}
    private static WebResourceResponse reply(int status,String reason,String mime,String text){return new WebResourceResponse(mime,"UTF-8",status,reason,Collections.singletonMap("Cache-Control","no-store"),new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));}
    private static String mime(String path){if(path.endsWith(".html"))return "text/html";if(path.endsWith(".js"))return "text/javascript";if(path.endsWith(".css"))return "text/css";if(path.endsWith(".json"))return "application/json";if(path.endsWith(".png"))return "image/png";if(path.endsWith(".jpg")||path.endsWith(".jpeg"))return "image/jpeg";if(path.endsWith(".svg"))return "image/svg+xml";if(path.endsWith(".woff2"))return "font/woff2";return "application/octet-stream";}
}
