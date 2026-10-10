package dev.scriptable.android;

import android.content.Context;
import android.net.Uri;
import android.os.*;
import android.webkit.*;
import org.json.*;
import java.net.HttpURLConnection;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Executes a saved widget script with the same isolated Worker/API bundle as the editor. */
final class HeadlessWidgetRunner {
    private final Context context;private final JSONObject config;private final Consumer<String> done;
    private final Handler main=new Handler(Looper.getMainLooper());private final ExecutorService io=Executors.newFixedThreadPool(2);
    private final Set<String> pending=ConcurrentHashMap.newKeySet();private final Map<HttpURLConnection,String> connections=new ConcurrentHashMap<>();
    private ScriptRepository repository;private AndroidServices services;private WebView web;private String token;private boolean ended;
    HeadlessWidgetRunner(Context c,JSONObject cfg,Consumer<String> callback){context=c;config=cfg;done=callback;}
    void start(){main.post(()->{try{
        repository=new ScriptRepository(context);JSONObject script=repository.find(config.getString("scriptId"));web=new WebView(context);token=NativeResources.register(context);
        services=new AndroidServices(context,new AndroidServices.Callback(){public void resolve(String id,Object value){reply(id,true,value);}public void reject(String id,Exception e){reply(id,false,e.getMessage());}});
        web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(true);web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);web.addJavascriptInterface(new Bridge(),"Android");
        web.setWebViewClient(new WebViewClient(){@Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){return NativeResources.response(r.getUrl());}@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return !NativeResources.isLocal(r.getUrl());}@Override public void onPageFinished(WebView v,String url){if(!url.endsWith("/headless.html"))return;web.evaluateJavascript("window.__runWidget("+script+","+JSONObject.quote(config.optString("parameter",""))+","+JSONObject.quote(config.optString("family","medium"))+","+config.optInt("widgetId")+")",null);}});
        web.onResume();web.loadUrl(NativeResources.ORIGIN+"/assets/headless.html");main.postDelayed(()->finish("后台脚本超过 90 秒，已停止"),90000);
    }catch(Exception e){finish(e.getMessage());}});}
    private JSONObject bootstrap()throws Exception{
        android.util.DisplayMetrics m=context.getResources().getDisplayMetrics();android.os.BatteryManager battery=(android.os.BatteryManager)context.getSystemService(Context.BATTERY_SERVICE);int level=battery.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY);
        JSONObject device=new JSONObject().put("name",Build.MANUFACTURER+" "+Build.MODEL).put("model",Build.MODEL).put("systemName","Android").put("systemVersion",Build.VERSION.RELEASE).put("screenSize",new JSONObject().put("width",m.widthPixels/m.density).put("height",m.heightPixels/m.density)).put("screenScale",m.density).put("locale",Locale.getDefault().toLanguageTag()).put("batteryLevel",level<0?-1:level/100.0).put("isCharging",battery.isCharging()).put("isDark",(context.getResources().getConfiguration().uiMode&48)==32);
        return new JSONObject().put("scripts",repository.list()).put("files",repository.fileSnapshot()).put("keychain",repository.keychainSnapshot()).put("device",device).put("settings",repository.settings()).put("fileMetadata",repository.metadata()).put("cloud",NativeCloudFolder.status(context)).put("nativeRuntime",true).put("nativeSyncUrl",NativeResources.ORIGIN+"/native-sync").put("nativeToken",token);
    }
    private final class Bridge{
        @JavascriptInterface public String callSync(String action,String raw){try{if(!"bootstrap".equals(action))throw new Exception("Background sync action unavailable");return new JSONObject().put("ok",true).put("result",bootstrap()).toString();}catch(Exception e){return "{\"ok\":false,\"error\":"+JSONObject.quote(String.valueOf(e.getMessage()))+"}";}}
        @JavascriptInterface public void call(String raw){String id=null;try{JSONObject p=new JSONObject(raw);id=p.getString("id");final String requestId=id,action=p.getString("action");JSONObject input=p.optJSONObject("payload");final JSONObject data=input==null?new JSONObject():input;if(ended)return;pending.add(id);
            if(services.handles(action)){main.post(()->{if(!ended)services.call(requestId,action,data);});return;}
            io.execute(()->{try{if(ended||!pending.contains(requestId))return;Object result;
                if(action.equals("request")){data.put("timeoutInterval",Math.min(45,data.optDouble("timeoutInterval",45)));result=HttpTransport.request(requestId,data,connections,()->!ended&&pending.contains(requestId));}
                else if(action.equals("widget.save")){data.put("targetWidgetId",config.getInt("widgetId"));data.put("scriptId",config.getString("scriptId"));data.put("parameter",config.optString("parameter",""));data.put("family",config.optString("family","medium"));result=ScriptWidgetProvider.save(context,data);}
                else if(action.equals("file.op")){result=NativeCloudFolder.fileOperation(context,repository,data);}
                else if(action.equals("file.metadata"))result=repository.metadataOperation(data);
                else if(action.equals("repo.save"))result=repository.save(data);
                else if(action.equals("repo.delete"))result=repository.delete(data.getString("id"));
                else if(action.equals("keychain.op"))result=repository.keychainOperation(data);
                else if(action.startsWith("notification."))result=ScriptNotifications.call(context,action,data);
                else if(action.equals("cloud.sync"))result=NativeCloudFolder.sync(context,data);
                else if(action.equals("runtime.start"))result=true;
                else if(action.equals("runtime.finish")||action.equals("runtime.cancel")){for(HttpURLConnection c:connections.keySet())c.disconnect();result=true;}
                else throw new Exception("后台小组件无法显示界面或使用剪贴板："+action);
                reply(requestId,true,result);
            }catch(Exception e){reply(requestId,false,e.getMessage());}});
        }catch(Exception e){if(id!=null)reply(id,false,e.getMessage());}}
        @JavascriptInterface public void widgetDone(String raw){try{JSONObject p=new JSONObject(raw);finish(p.optBoolean("ok")?null:p.optString("error","脚本失败"));}catch(Exception e){finish(e.getMessage());}}
    }
    private void reply(String id,boolean ok,Object value){if(!pending.remove(id)||ended)return;try{String encoded=new JSONArray().put(value==null?JSONObject.NULL:value).toString();encoded=encoded.substring(1,encoded.length()-1);final String js="window.__nativeResolve("+JSONObject.quote(id)+","+ok+","+encoded+")";main.post(()->{if(!ended&&web!=null)web.evaluateJavascript(js,null);});}catch(Exception e){finish(e.getMessage());}}
    void stop(){finish("后台任务被安卓系统停止");}
    private void finish(String error){main.post(()->{if(ended)return;ended=true;if(services!=null)services.close();for(HttpURLConnection c:connections.keySet())c.disconnect();connections.clear();pending.clear();io.shutdownNow();if(web!=null){web.removeJavascriptInterface("Android");web.stopLoading();web.destroy();web=null;}if(token!=null)NativeResources.unregister(token);done.accept(error);});}
}
