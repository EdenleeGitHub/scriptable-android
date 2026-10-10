package dev.scriptable.android;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.text.InputType;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String ENTRY = ORIGIN + "/assets/index.html";
    private static final int PICK_SCRIPT = 101, EXPORT_SCRIPT = 102, NOTIFICATION_PERMISSION = 103;
    private final ThreadPoolExecutor executor = new ThreadPoolExecutor(2, 3, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(32));
    private final Set<String> pending = Collections.synchronizedSet(new HashSet<>());
    private final Map<HttpURLConnection, String> connections = new ConcurrentHashMap<>();
    private final Map<String, String> requestRuns = new ConcurrentHashMap<>();
    private final Map<String,JSONObject> runParameters=new ConcurrentHashMap<>();
    private final Map<String, AlertDialog> dialogs = new java.util.HashMap<>();
    private WebView web;
    private ScriptRepository repository;
    private volatile boolean destroyed;
    private boolean loaded;
    private boolean uiReady;
    private String openScript;
    private boolean runOpenScript;
    private String pickerId, exportId;
    private JSONObject exportScript;
    private String notificationId;
    private JSONObject notificationPayload;
    private TextToSpeech speech;
    private boolean speechReady;
    private String speechId;
    private JSONObject speechPayload;
    private volatile String clipboardCache;
    private AndroidServices systemServices;
    private NativePresentation presentation;
    private NativeCloudFolder cloudFolder;
    private String nativeToken;
    private JSONObject launchArgs=new JSONObject();
    private JSONObject launchConfig=new JSONObject();
    private boolean openScriptSettings;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try { repository = new ScriptRepository(this); }
        catch (Exception error) {
            TextView message = new TextView(this);
            message.setPadding(32, 64, 32, 32);
            message.setText("Private storage could not be opened.\n" + error.getMessage());
            setContentView(message);
            return;
        }
        web = new WebView(this);
        nativeToken=NativeResources.register(this);
        systemServices=new AndroidServices(this,new AndroidServices.Callback(){public void resolve(String id,Object value){MainActivity.this.resolve(id,value);}public void reject(String id,Exception error){MainActivity.this.reject(id,error);}});
        presentation=new NativePresentation(this,new NativePresentation.Callback(){public void resolve(String id,Object value){MainActivity.this.resolve(id,value);}public void reject(String id,Exception error){MainActivity.this.reject(id,error);}public void event(String id,JSONObject value){nativeEvent(id,value);}});
        cloudFolder=new NativeCloudFolder(this,new NativeCloudFolder.Callback(){public void resolve(String id,Object value){MainActivity.this.resolve(id,value);}public void reject(String id,Exception error){MainActivity.this.reject(id,error);}});
        FrameLayout viewport=new FrameLayout(this);
        viewport.addView(web,new FrameLayout.LayoutParams(-1,-1));
        setContentView(viewport);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        viewport.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, Math.max(safe.bottom, keyboard.bottom));
            } else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return Build.VERSION.SDK_INT>=30?WindowInsets.CONSUMED:insets;
        });
        viewport.requestApplyInsets();
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web.addJavascriptInterface(new NativeHost(), "Android");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (isAppAsset(request.getUrl())) return false;
                if (request.isForMainFrame()) safeBrowser(request.getUrl().toString());
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if(NativeResources.isLocal(uri))return NativeResources.response(uri);
                if (!isAppAsset(uri)) return emptyResponse(403, "Remote WebView resources are disabled");
                String path = uri.getPath();
                if (path == null || !path.startsWith("/assets/")) return emptyResponse(404, "Not found");
                String asset = path.substring("/assets/".length());
                if (asset.isEmpty() || asset.contains("..") || asset.contains("\\") || asset.indexOf('\0') >= 0) return emptyResponse(403, "Invalid asset path");
                try {
                    InputStream stream = getAssets().open(asset);
                    WebResourceResponse response = new WebResourceResponse(mime(asset), "UTF-8", stream);
                    Map<String, String> headers = new java.util.HashMap<>();
                    headers.put("Cache-Control", "no-cache");
                    headers.put("X-Content-Type-Options", "nosniff");
                    if (asset.endsWith(".html")) headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' data: blob:; object-src 'none'; base-uri 'none'");
                    response.setResponseHeaders(headers);
                    return response;
                } catch (Exception error) { return emptyResponse(404, "Not found"); }
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!ENTRY.equals(url)) return;
                loaded = true;
                dispatchOpenScript();
            }
        });
        if (savedInstanceState == null) handleIntent(getIntent());
        else {
            openScript = savedInstanceState.getString("pendingScript");
            runOpenScript = savedInstanceState.getBoolean("pendingRun", false);
        }
        web.loadUrl(ENTRY);
    }

    private static boolean isAppAsset(Uri uri) {
        return "https".equalsIgnoreCase(uri.getScheme()) && "appassets.androidplatform.net".equalsIgnoreCase(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private static WebResourceResponse emptyResponse(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, status == 404 ? "Not Found" : "Forbidden", Collections.emptyMap(), new ByteArrayInputStream(reason.getBytes(StandardCharsets.UTF_8)));
    }

    @Override public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if(presentation!=null&&presentation.onIntent(intent))return;
        handleIntent(intent);
        dispatchOpenScript();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        state.putString("pendingScript", openScript);
        state.putBoolean("pendingRun", runOpenScript);
        super.onSaveInstanceState(state);
    }

    private void handleIntent(Intent intent) {
        if(intent==null)return;if(presentation!=null&&presentation.onIntent(intent))return;
        try{
            String notice=intent.getStringExtra("notification");if(notice!=null){launchArgs.put("notification",new JSONObject(notice));launchConfig.put("runsInNotification",true);}Uri uri=intent.getData();String scheme=uri==null?"":uri.getScheme();
            if(uri!=null&&("scriptable-android".equals(scheme)||"scriptable".equals(scheme))){
                String operation=uri.getHost();if(operation==null||operation.isEmpty())operation=uri.getPath()==null?"":uri.getPath().replaceFirst("^/+","");
                if(operation.equals("run")||operation.equals("open")){
                    String id=uri.getQueryParameter("id");if(id==null){String name=uri.getQueryParameter("scriptName");JSONArray scripts=repository.list();for(int i=0;i<scripts.length();i++)if(scripts.getJSONObject(i).optString("name").equals(name))id=scripts.getJSONObject(i).getString("id");}
                    if(id==null)return;repository.find(id);JSONObject parameters=new JSONObject();for(String key:uri.getQueryParameterNames())parameters.put(key,uri.getQueryParameter(key));
                    Object notification=launchArgs.opt("notification");launchArgs=new JSONObject().put("queryParameters",parameters);if(notification!=null)launchArgs.put("notification",notification);
                    for(String key:new String[]{"shortcutParameter","widgetParameter"}){String value=uri.getQueryParameter(key);if(value!=null)launchArgs.put(key,key.equals("shortcutParameter")?parseArgument(value):value);}
                    String notificationText=intent.getStringExtra("notification");if(notificationText!=null)launchArgs.put("notification",new JSONObject(notificationText));
                    launchConfig=new JSONObject().put("runsInActionExtension",false).put("runsInNotification",launchArgs.has("notification")).put("runsFromHomeScreen",intent.getBooleanExtra("fromHomeScreen",false));openScript=id;runOpenScript=operation.equals("run");openScriptSettings="true".equals(uri.getQueryParameter("settings"));return;
                }
            }
            if(Intent.ACTION_SEND.equals(intent.getAction())||Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction()))receiveShared(intent);
        }catch(Exception error){showError("无法打开脚本",errorMessage(error));}
    }
    private static Object parseArgument(String text){try{return new org.json.JSONTokener(text).nextValue();}catch(Exception ignored){return text;}}
    private void receiveShared(Intent intent){
        final String type=intent.getType()==null?"":intent.getType();final String text=intent.getStringExtra(Intent.EXTRA_TEXT);final java.util.ArrayList<Uri> streams=new java.util.ArrayList<>();
        if(Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())){java.util.ArrayList<Uri> multiple=intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);if(multiple!=null)streams.addAll(multiple);}else{Uri stream=intent.getParcelableExtra(Intent.EXTRA_STREAM);if(stream!=null)streams.add(stream);}
        executor.execute(()->{try{
            boolean javascript=type.equals("application/javascript")||type.equals("application/x-javascript")||type.equals("text/javascript");
            if(!javascript&&streams.size()==1){String name=sharedName(streams.get(0));javascript=type.contains("javascript")||name.toLowerCase(java.util.Locale.ROOT).endsWith(".js");}
            if(javascript){String source=text;if(source==null&&!streams.isEmpty())try(InputStream input=getContentResolver().openInputStream(streams.get(0))){source=new String(ScriptRepository.readStream(input,ScriptRepository.MAX_SCRIPT_BYTES),StandardCharsets.UTF_8);}if(source==null)throw new Exception("未收到 JavaScript 内容");JSONObject script=repository.save(new JSONObject().put("name",streams.isEmpty()?"导入的脚本":documentName(streams.get(0))).put("code",source));openScript=script.getString("id");runOpenScript=false;runOnUiThread(this::dispatchOpenScript);return;}
            JSONObject args=new JSONObject();JSONArray texts=new JSONArray(),urls=new JSONArray(),images=new JSONArray(),files=new JSONArray();if(text!=null){texts.put(text);java.util.regex.Matcher links=java.util.regex.Pattern.compile("https?://[^\\s]+",java.util.regex.Pattern.CASE_INSENSITIVE).matcher(text);while(links.find())urls.put(links.group());}
            String folder="/documents/shared-"+UUID.randomUUID().toString();boolean madeFolder=false;
            int index=0;for(Uri stream:streams){if(index>=20)throw new Exception("一次最多分享 20 个文件");String mime=getContentResolver().getType(stream);byte[] bytes;try(InputStream input=getContentResolver().openInputStream(stream)){if(input==null)throw new Exception("分享文件无法读取");bytes=ScriptRepository.readStream(input,16*1024*1024);}
                if(mime!=null&&mime.startsWith("image/")){android.graphics.BitmapFactory.Options bounds=new android.graphics.BitmapFactory.Options();bounds.inJustDecodeBounds=true;android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.length,bounds);int sample=1;while(bounds.outWidth/sample>2048||bounds.outHeight/sample>2048)sample*=2;android.graphics.BitmapFactory.Options options=new android.graphics.BitmapFactory.Options();options.inSampleSize=sample;android.graphics.Bitmap bitmap=android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);if(bitmap==null)throw new Exception("图片无法解码");java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();bitmap.compress(bitmap.hasAlpha()?android.graphics.Bitmap.CompressFormat.PNG:android.graphics.Bitmap.CompressFormat.JPEG,85,out);boolean alpha=bitmap.hasAlpha();bitmap.recycle();images.put(new JSONObject().put("base64",Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP)).put("mimeType",alpha?"image/png":"image/jpeg"));}
                else{if(!madeFolder){repository.fileOperation(new JSONObject().put("op","createDirectory").put("path",folder));madeFolder=true;}String filename=sharedName(stream).replaceAll("[\\\\/:*?\"<>|]","_");String path=folder+"/"+(index+1)+"-"+filename;repository.fileOperation(new JSONObject().put("op","write").put("path",path).put("base64",Base64.encodeToString(bytes,Base64.NO_WRAP)));files.put(path);}index++;
            }
            args.put("plainTexts",texts).put("urls",urls).put("images",images).put("fileURLs",files);Object notification=launchArgs.opt("notification");if(notification!=null)args.put("notification",notification);launchArgs=args;launchConfig=new JSONObject().put("runsInActionExtension",true);
            runOnUiThread(()->{try{JSONArray scripts=repository.list();String[] names=new String[scripts.length()];for(int i=0;i<scripts.length();i++)names[i]=scripts.getJSONObject(i).getString("name");new AlertDialog.Builder(this).setTitle("选择处理分享内容的脚本").setItems(names,(dialog,which)->{try{openScript=scripts.getJSONObject(which).getString("id");runOpenScript=true;dispatchOpenScript();}catch(Exception e){showError("无法运行",e.getMessage());}}).setNegativeButton("取消",null).show();}catch(Exception e){showError("无法打开",e.getMessage());}});
        }catch(Exception error){showError("分享内容无法导入",errorMessage(error));}});
    }

    private void dispatchOpenScript() {
        if (!loaded || !uiReady || openScript == null || web == null) return;
        String scriptId = openScript;
        boolean run = runOpenScript;
        openScript = null;
        web.evaluateJavascript("window.__openScript&&window.__openScript(" + JSONObject.quote(scriptId) + "," + run + ", {settings:"+openScriptSettings+"})", null);
    }
    private String sharedName(Uri uri){try(android.database.Cursor cursor=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(cursor!=null&&cursor.moveToFirst()&&cursor.getString(0)!=null)return cursor.getString(0);}catch(Exception ignored){}return "Shared document";}

    @Override public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        web.evaluateJavascript("(typeof window.__goBack==='function'?window.__goBack():false)", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }

    @Override protected void onResume() {
        super.onResume();
        clipboardCache = readClipboard();
        if (web != null) web.onResume();
    }

    @Override protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override protected void onDestroy() {
        destroyed = true;
        if(systemServices!=null)systemServices.close();
        if(presentation!=null)presentation.close();
        if(nativeToken!=null)NativeResources.unregister(nativeToken);
        executor.shutdownNow();
        for (HttpURLConnection connection : connections.keySet()) connection.disconnect();
        connections.clear();
        for (AlertDialog dialog : new HashSet<>(dialogs.values())) dialog.dismiss();
        dialogs.clear();
        if (speech != null) { speech.stop(); speech.shutdown(); }
        pending.clear();
        requestRuns.clear();
        if (web != null) { web.removeJavascriptInterface("Android"); web.stopLoading(); web.destroy(); web = null; }
        super.onDestroy();
    }

    private final class NativeHost {
        @JavascriptInterface public String callSync(String action, String payloadJson) {
            try {
                if (destroyed) throw new Exception("Activity was closed");
                int limit = "repo.save".equals(action) ? 2 * 1024 * 1024 : 16384;
                if (payloadJson != null && payloadJson.length() > limit) throw new Exception("Payload is too large");
                JSONObject payload = payloadJson == null || payloadJson.isEmpty() ? new JSONObject() : new JSONObject(payloadJson);
                Object result;
                switch (action) {
                    case "bootstrap": result = bootstrap(); break;
                    case "repo.list": result = repository.list(); break;
                    case "repo.save": result = repository.save(payload); break;
                    case "repo.delete": result = repository.delete(payload.getString("id")); break;
                    case "settings.get": result = repository.settings(); break;
                    case "settings.set": result = repository.setSettings(payload); break;
                    default: throw new Exception("This action is available only through the asynchronous bridge");
                }
                return new JSONObject().put("ok", true).put("result", result == null ? JSONObject.NULL : result).toString();
            } catch (Exception error) { return envelopeError(error); }
        }

        @JavascriptInterface public void call(String requestJson) {
            String id = null;
            try {
                if (destroyed) return;
                if (requestJson == null || requestJson.length() > 24 * 1024 * 1024) throw new Exception("Bridge request is too large");
                JSONObject request = new JSONObject(requestJson);
                id = request.get("id").toString();
                if (id.length() == 0 || id.length() > 100 || !id.matches("[A-Za-z0-9._:-]+")) throw new Exception("Invalid request ID");
                if (!pending.add(id)) return;
                if (pending.size() > 40) throw new Exception("Too many pending native requests");
                String runId = request.optString("runId", "");
                if (!runId.isEmpty()) {
                    if (runId.length() > 100 || !runId.matches("[A-Za-z0-9._:-]+")) throw new Exception("Invalid execution ID");
                    requestRuns.put(id, runId);
                }
                final String callbackId = id;
                String action = request.getString("action");
                JSONObject payload = request.optJSONObject("payload");
                if (payload == null) payload = new JSONObject();
                final JSONObject data = payload;
                if (isUiAction(action)||(systemServices!=null&&systemServices.handles(action))||(presentation!=null&&presentation.handles(action))||action.equals("cloud.configure")||action.equals("widget.refresh")||action.equals("alarm.settings")||action.equals("ui.theme")||action.equals("shortcut.pin")) runOnUiThread(() -> {
                    if (!pending.contains(callbackId)) return;
                    try { if(systemServices!=null&&systemServices.handles(action))systemServices.call(callbackId,action,data);else if(presentation!=null&&presentation.handles(action))presentation.handle(callbackId,action,data,requestRuns.get(callbackId));else uiAction(callbackId, action, data); } catch (Exception error) { reject(callbackId, error); }
                });
                else executor.execute(() -> {
                    if (!pending.contains(callbackId)) return;
                    try { resolve(callbackId, backgroundAction(callbackId, action, data)); }
                    catch (Exception error) { reject(callbackId, error); }
                });
            } catch (Exception error) { if (id != null) reject(id, error); }
        }
    }

    private String envelopeError(Exception error) {
        try { return new JSONObject().put("ok", false).put("error", errorMessage(error)).toString(); }
        catch (Exception ignored) { return "{\"ok\":false,\"error\":\"Native operation failed\"}"; }
    }

    private static String errorMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.isEmpty() ? error.getClass().getSimpleName() : message;
    }

    private void resolve(String id, Object value) { complete(id, true, value); }
    private void reject(String id, Exception error) { complete(id, false, errorMessage(error)); }
    private void nativeEvent(String id,JSONObject value){runOnUiThread(()->{if(!destroyed&&web!=null)web.evaluateJavascript("window.__nativeEvent&&window.__nativeEvent("+JSONObject.quote(id)+","+value+")",null);});}
    private void returnToCaller(JSONObject payload,boolean success){
        JSONObject parameters=runParameters.remove(payload.optString("runId"));if(parameters==null)return;String callback=parameters.optString(success?"x-success":"x-error","");if(callback.isEmpty())return;
        try{Uri uri=Uri.parse(callback);String scheme=uri.getScheme();if(scheme==null||scheme.matches("(?i)javascript|data|file|content|intent"))throw new Exception("不支持的回调链接");Object output=success?payload.opt("output"):payload.optString("error","已停止");String result=output==null?"":output instanceof String?(String)output:output.toString();if(result.length()>12000)throw new Exception("回调结果过大，请使用文件导出或分享传递二进制结果");Intent intent=new Intent(Intent.ACTION_VIEW,uri.buildUpon().appendQueryParameter(success?"result":"errorMessage",result).build()).addCategory(Intent.CATEGORY_BROWSABLE);startActivity(intent);}catch(Exception error){showError("调用方回调无法打开",error.getMessage());}
    }

    private void complete(String id, boolean ok, Object value) {
        if (!pending.remove(id) || destroyed) return;
        requestRuns.remove(id);
        String encoded;
        try {
            String wrapped = new JSONArray().put(value == null ? JSONObject.NULL : value).toString();
            if (wrapped == null || wrapped.length() < 2) throw new Exception("Invalid JSON result");
            encoded = wrapped.substring(1, wrapped.length() - 1);
        }
        catch (Exception ignored) { encoded = JSONObject.quote("Native result could not be encoded"); ok = false; }
        final String expression = "window.__nativeResolve&&window.__nativeResolve(" + JSONObject.quote(id) + "," + ok + "," + encoded + ")";
        runOnUiThread(() -> { if (!destroyed && web != null) web.evaluateJavascript(expression, null); });
    }

    private JSONObject bootstrap() throws Exception {
        clipboardCache = readClipboard();
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        BatteryManager battery = (BatteryManager) getSystemService(BATTERY_SERVICE);
        int batteryPercent = battery == null ? -1 : battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
        JSONObject device = new JSONObject().put("name", Build.MANUFACTURER + " " + Build.MODEL).put("model", Build.MODEL)
                .put("systemName", "Android").put("systemVersion", Build.VERSION.RELEASE)
                .put("batteryLevel", batteryPercent < 0 || batteryPercent > 100 ? -1 : batteryPercent / 100.0)
                .put("screenSize", new JSONObject().put("width", metrics.widthPixels / metrics.density).put("height", metrics.heightPixels / metrics.density))
                .put("screenScale", metrics.density).put("locale", Locale.getDefault().toLanguageTag())
                .put("isCharging", battery != null && battery.isCharging())
                .put("isDark", (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES);
        return new JSONObject().put("scripts", repository.list()).put("files", repository.fileSnapshot())
                .put("keychain", repository.keychainSnapshot()).put("device", device).put("settings", repository.settings())
                .put("clipboard", clipboardCache == null ? JSONObject.NULL : clipboardCache)
                .put("nativeRuntime",true).put("nativeSyncUrl",ORIGIN+"/native-sync").put("nativeToken",nativeToken)
                .put("fileMetadata",repository.metadata()).put("cloud",NativeCloudFolder.status(this)).put("args",launchArgs).put("launchConfig",launchConfig);
    }

    private static boolean isUiAction(String action) {
        switch (action) {
            case "repo.import": case "repo.export": case "alert": case "clipboard.read": case "clipboard.write":
            case "notification.schedule": case "safari.open": case "share": case "speech": case "widget.pin": case "ui.ready": case "runtime.cancel": case "runtime.finish": case "runtime.start": return true;
            default: return false;
        }
    }

    private Object backgroundAction(String id, String action, JSONObject payload) throws Exception {
        if(action.equals("notification.resetCurrent")){launchArgs.remove("notification");return true;}
        if(action.startsWith("notification."))return ScriptNotifications.call(this,action,payload);
        switch (action) {
            case "bootstrap": return bootstrap();
            case "repo.list": return repository.list();
            case "repo.save": return repository.save(payload);
            case "repo.delete": return repository.delete(payload.getString("id"));
            case "settings.get": return repository.settings();
            case "settings.set": return repository.setSettings(payload);
            case "file.op": {return NativeCloudFolder.fileOperation(this,repository,payload);}
            case "file.metadata":return repository.metadataOperation(payload);
            case "cloud.sync":return NativeCloudFolder.sync(this,payload);
            case "keychain.op": return repository.keychainOperation(payload);
            case "request": return HttpTransport.request(id,payload,connections,()->pending.contains(id));
            case "widget.save": return ScriptWidgetProvider.save(this, payload);
            case "preview": return payload;
            default: throw new Exception("Unsupported Android action: " + action);
        }
    }

    private void uiAction(String id, String action, JSONObject payload) throws Exception {
        if (destroyed) throw new Exception("Activity was closed");
        switch (action) {
            case "ui.ready": uiReady = true; dispatchOpenScript(); resolve(id, true); break;
            case "ui.theme":{
                boolean dark=payload.optBoolean("dark");int color=dark?0xFF141925:0xFFF7F8FC;
                if(web.getParent() instanceof android.view.View)((android.view.View)web.getParent()).setBackgroundColor(color);
                getWindow().setStatusBarColor(color);getWindow().setNavigationBarColor(color);
                if(Build.VERSION.SDK_INT>=30){android.view.WindowInsetsController controller=getWindow().getInsetsController();if(controller!=null)controller.setSystemBarsAppearance(dark?0:android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);}
                else{int flags=getWindow().getDecorView().getSystemUiVisibility();int light=View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;getWindow().getDecorView().setSystemUiVisibility(dark?flags&~light:flags|light);}resolve(id,true);break;
            }
            case "shortcut.pin":{
                JSONObject script=repository.find(payload.getString("scriptId"));android.content.pm.ShortcutManager manager=(android.content.pm.ShortcutManager)getSystemService(SHORTCUT_SERVICE);if(!manager.isRequestPinShortcutSupported())throw new Exception("当前桌面不支持固定快捷方式");
                Intent run=new Intent(this,MainActivity.class).setAction(Intent.ACTION_VIEW).putExtra("fromHomeScreen",true).setData(Uri.parse("scriptable-android://run?id="+Uri.encode(script.getString("id"))));
                android.content.pm.ShortcutInfo info=new android.content.pm.ShortcutInfo.Builder(this,"script-"+script.getString("id")).setShortLabel(script.getString("name")).setIcon(android.graphics.drawable.Icon.createWithResource(this,R.mipmap.ic_launcher_v2)).setIntent(run).build();resolve(id,manager.requestPinShortcut(info,null));break;
            }
            case "runtime.start":runParameters.put(payload.getString("runId"),payload.optJSONObject("queryParameters")==null?new JSONObject():payload.getJSONObject("queryParameters"));resolve(id,true);break;
            case "runtime.cancel": cancelRun(payload.getString("runId"));returnToCaller(payload,false);resolve(id, true); break;
            case "runtime.finish":if(presentation!=null)presentation.finishRun(payload.getString("runId"));returnToCaller(payload,true);resolve(id,true);break;
            case "cloud.configure":cloudFolder.choose(id,payload);break;
            case "widget.refresh":ScriptWidgetProvider.refreshNow(this);resolve(id,true);break;
            case "alarm.settings":if(Build.VERSION.SDK_INT>=31)startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+getPackageName())));else startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())));resolve(id,true);break;
            case "repo.import":
                if (pickerId != null) throw new Exception("A document picker is already open");
                pickerId = id;
                try {
                    Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                    startActivityForResult(picker, PICK_SCRIPT);
                } catch (Exception error) { pickerId = null; throw error; }
                break;
            case "repo.export":
                if (exportId != null) throw new Exception("An export picker is already open");
                JSONObject script = repository.find(payload.getString("id"));
                exportId = id; exportScript = script;
                try {
                    Intent picker = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("text/javascript")
                            .putExtra(Intent.EXTRA_TITLE, script.getString("name").replaceAll("[\\\\/:*?\"<>|]", "_") + ".js");
                    startActivityForResult(picker, EXPORT_SCRIPT);
                } catch (Exception error) { exportId = null; exportScript = null; throw error; }
                break;
            case "alert": showScriptAlert(id, payload); break;
            case "clipboard.read": clipboardCache = readClipboard(); resolve(id, clipboardCache); break;
            case "clipboard.write": {
                String text = payload.optString("text", "");
                if (text.length() > ScriptRepository.MAX_SCRIPT_BYTES) throw new Exception("Clipboard text exceeds the 1 MB limit");
                ClipboardManager manager = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                manager.setPrimaryClip(ClipData.newPlainText("Script", text));
                clipboardCache = text; resolve(id, true); break;
            }
            case "notification.schedule": scheduleNotification(id, payload); break;
            case "safari.open": safeBrowserOrThrow(payload.getString("url")); resolve(id, true); break;
            case "share": {
                String text = payload.optString("text", "");
                if (text.length() > ScriptRepository.MAX_SCRIPT_BYTES) throw new Exception("Shared text exceeds the 1 MB limit");
                Intent intent = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(intent, "Share script output")); resolve(id, true); break;
            }
            case "speech": speak(id, payload); break;
            case "widget.pin": {
                resolve(id,ScriptWidgetProvider.requestPin(this,payload)); break;
            }
            default: throw new Exception("Unsupported UI action");
        }
    }

    private String readClipboard() {
        try {
            ClipboardManager manager = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            ClipData clip = manager.getPrimaryClip();
            if (clip == null || clip.getItemCount() == 0) return null;
            String text = clip.getItemAt(0).coerceToText(this).toString();
            return text.length() > ScriptRepository.MAX_SCRIPT_BYTES ? null : text;
        } catch (Exception ignored) { return null; }
    }

    private void safeBrowser(String url) {
        try { safeBrowserOrThrow(url); } catch (Exception error) { showError("Cannot open URL", errorMessage(error)); }
    }

    private void safeBrowserOrThrow(String url) throws Exception {
        Uri uri = Uri.parse(url);
        if ((!"https".equalsIgnoreCase(uri.getScheme()) && !"http".equalsIgnoreCase(uri.getScheme())) || uri.getHost() == null || uri.getUserInfo() != null)
            throw new Exception("Only HTTP and HTTPS browser URLs are supported");
        startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
    }

    private void showError(String title, String message) {
        if (destroyed) return;
        runOnUiThread(() -> { if (!destroyed) new AlertDialog.Builder(this).setTitle(title).setMessage(message).setPositiveButton("OK", null).show(); });
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if(cloudFolder!=null&&cloudFolder.result(requestCode,resultCode,data))return;
        if(systemServices!=null&&systemServices.onActivityResult(requestCode,resultCode,data))return;
        if (requestCode == PICK_SCRIPT) {
            String id = pickerId; pickerId = null;
            if (id == null) return;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) { resolve(id, JSONObject.NULL); return; }
            Uri uri = data.getData();
            executor.execute(() -> {
                try (InputStream stream = getContentResolver().openInputStream(uri)) {
                    if (stream == null) throw new Exception("Document is unavailable");
                    String text = new String(ScriptRepository.readStream(stream, ScriptRepository.MAX_SCRIPT_BYTES), StandardCharsets.UTF_8);
                    if (text.startsWith("\uFEFF")) text = text.substring(1);
                    resolve(id, repository.save(new JSONObject().put("name", documentName(uri)).put("code", text)));
                } catch (Exception error) { reject(id, error); }
            });
        } else if (requestCode == EXPORT_SCRIPT) {
            String id = exportId; JSONObject script = exportScript;
            exportId = null; exportScript = null;
            if (id == null) return;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) { resolve(id, false); return; }
            Uri uri = data.getData();
            executor.execute(() -> {
                try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new Exception("Export document is unavailable");
                    output.write(script.getString("code").getBytes(StandardCharsets.UTF_8));
                    output.flush(); resolve(id, true);
                } catch (Exception error) { reject(id, error); }
            });
        }
    }

    private String documentName(Uri uri) {
        String name = "Imported script";
        try (android.database.Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
        } catch (Exception ignored) { }
        if (name == null || name.trim().isEmpty()) name = "Imported script";
        name = name.replaceFirst("(?i)\\.(js|mjs|txt)$", "");
        return name.length() > 120 ? name.substring(0, 120) : name;
    }

    private void showScriptAlert(String id, JSONObject payload) throws Exception {
        JSONArray actions = payload.optJSONArray("actions");
        if (actions == null) actions = new JSONArray();
        JSONArray fields = payload.optJSONArray("textFields");
        if (fields == null) fields = new JSONArray();
        if (actions.length() > 50 || fields.length() > 24) throw new Exception("Alert supports up to 50 actions and 24 text fields");
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (20 * getResources().getDisplayMetrics().density);
        panel.setPadding(padding, padding / 2, padding, padding / 2);
        String message = payload.optString("message", "");
        if (message.length() > 10000) throw new Exception("Alert message is too long");
        if (!message.isEmpty()) { TextView label = new TextView(this); label.setText(message); panel.addView(label); }
        EditText[] inputs = new EditText[fields.length()];
        for (int i = 0; i < fields.length(); i++) {
            JSONObject field = fields.getJSONObject(i);
            EditText input = new EditText(this);
            input.setSingleLine(true); input.setHint(field.optString("placeholder", "")); input.setText(field.optString("value", ""));
            int inputType=InputType.TYPE_CLASS_TEXT;
            switch(field.optString("keyboardType","default")){
                case "numberPad":inputType=InputType.TYPE_CLASS_NUMBER;break;
                case "decimalPad":inputType=InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL|InputType.TYPE_NUMBER_FLAG_SIGNED;break;
                case "phonePad":inputType=InputType.TYPE_CLASS_PHONE;break;
                case "emailAddress":inputType=InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS;break;
                case "url":case "twitter":inputType=InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI;break;
                case "webSearch":inputType=InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_WEB_EDIT_TEXT;break;
                case "numbersAndPunctuation":inputType=InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS;break;
            }
            if(field.optBoolean("secure"))inputType=(inputType&InputType.TYPE_MASK_CLASS)==InputType.TYPE_CLASS_NUMBER?InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_VARIATION_PASSWORD:InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD;
            input.setInputType(inputType);
            String textColor=NativeJson.string(field,"textColor","");if(textColor.matches("#[0-9a-fA-F]{8}"))textColor="#"+textColor.substring(7,9)+textColor.substring(1,7);if(!textColor.isEmpty())input.setTextColor(Color.parseColor(textColor));
            JSONObject font=field.optJSONObject("font");if(font!=null){input.setTextSize((float)Math.max(8,Math.min(40,font.optDouble("size",16))));String weight=font.optString("weight","normal");input.setTypeface(android.graphics.Typeface.create(font.optString("family","sans-serif"),weight.equals("bold")||weight.matches("[6-9]00")?android.graphics.Typeface.BOLD:android.graphics.Typeface.NORMAL));}
            input.setGravity(android.view.Gravity.CENTER_VERTICAL|("center".equals(field.optString("alignment"))?android.view.Gravity.CENTER_HORIZONTAL:"right".equals(field.optString("alignment"))?android.view.Gravity.RIGHT:android.view.Gravity.LEFT));
            inputs[i] = input; panel.addView(input);
        }
        android.widget.ScrollView scrolling=new android.widget.ScrollView(this);scrolling.addView(panel);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle(payload.optString("title", "")).setView(scrolling).create();
        AtomicBoolean answered = new AtomicBoolean();
        final java.util.function.IntConsumer finish = index -> {
            if (!answered.compareAndSet(false, true)) return;
            JSONArray values = new JSONArray(); for (EditText input : inputs) values.put(input.getText().toString());
            try { resolve(id, new JSONObject().put("index", index).put("values", values)); } catch (Exception error) { reject(id, error); }
            dialog.dismiss();
        };
        for (int i = 0; i < actions.length(); i++) {
            JSONObject action = actions.getJSONObject(i);
            Button button = new Button(this); button.setText(action.optString("title", "OK"));
            if (action.optBoolean("destructive")) button.setTextColor(Color.rgb(210, 50, 50));
            final int index = i; button.setOnClickListener(view -> finish.accept(index)); panel.addView(button);
        }
        String cancel = NativeJson.string(payload,"cancel", "");
        if (!cancel.isEmpty() || actions.length() == 0) {
            Button button = new Button(this); button.setText(cancel.isEmpty() ? "OK" : cancel); button.setOnClickListener(view -> finish.accept(-1)); panel.addView(button);
        }
        dialog.setOnCancelListener(ignored -> finish.accept(-1));
        dialog.setOnDismissListener(ignored -> dialogs.remove(id));
        dialogs.put(id, dialog); dialog.show();
    }

    private void cancelRun(String runId) throws Exception {
        if (runId.isEmpty() || runId.length() > 100) throw new Exception("Invalid execution ID");
        Set<String> cancelled = new HashSet<>();
        for (Map.Entry<String, String> entry : requestRuns.entrySet()) if (runId.equals(entry.getValue())) cancelled.add(entry.getKey());
        if(systemServices!=null)systemServices.cancel(cancelled);
        if(presentation!=null)presentation.cancel(cancelled);
        if(presentation!=null)presentation.finishRun(runId);
        if(cloudFolder!=null)cloudFolder.cancel(cancelled);
        for (String id : cancelled) reject(id, new Exception("Script execution was stopped"));
        for (Map.Entry<HttpURLConnection, String> entry : connections.entrySet()) if (cancelled.contains(entry.getValue())) entry.getKey().disconnect();
        for (String id : cancelled) {
            AlertDialog dialog = dialogs.get(id);
            if (dialog != null) dialog.dismiss();
        }
        if (speechId != null && cancelled.contains(speechId)) {
            if (speech != null) speech.stop();
            speechId = null; speechPayload = null;
        }
        if (notificationId != null && cancelled.contains(notificationId)) { notificationId = null; notificationPayload = null; }
    }

    private void scheduleNotification(String id, JSONObject payload) throws Exception {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            if(notificationId!=null)throw new Exception("已有通知权限请求正在打开");
            notificationId=id;notificationPayload=payload;
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},NOTIFICATION_PERMISSION);return;
        }
        postNotification(id,payload);
    }
    private void postNotification(String id, JSONObject payload) throws Exception {
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)throw new SecurityException("需要通知权限");
        resolve(id,ScriptNotifications.schedule(this,payload));
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if(systemServices!=null&&systemServices.onRequestPermissionsResult(requestCode,permissions,grantResults))return;
        if (requestCode != NOTIFICATION_PERMISSION || notificationId == null) return;
        String id = notificationId; JSONObject payload = notificationPayload;
        notificationId = null; notificationPayload = null;
        if (grantResults.length == 0 || grantResults[0] != PackageManager.PERMISSION_GRANTED) { reject(id, new Exception("Notification permission was denied")); return; }
        try { postNotification(id, payload); } catch (Exception error) { reject(id, error); }
    }

    private void speak(String id, JSONObject payload) throws Exception {
        String text = payload.optString("text", "");
        if (text.isEmpty() || text.length() > 4000) throw new Exception("Speech text must contain 1–4000 characters");
        if (speechId != null) throw new Exception("Speech is already in progress");
        speechId = id; speechPayload = payload;
        if (speech == null) {
            speech = new TextToSpeech(this, status -> runOnUiThread(() -> {
                if (destroyed) return;
                if (status != TextToSpeech.SUCCESS) {
                    finishSpeech(new Exception("Android text-to-speech is unavailable"));
                    if (speech != null) speech.shutdown();
                    speech = null; speechReady = false; return;
                }
                speechReady = true;
                if (speechId != null) startSpeech();
            }));
        } else if (speechReady) startSpeech();
    }

    private void startSpeech() {
        try {
            String language = speechPayload.optString("language", Locale.getDefault().toLanguageTag());
            int languageResult = speech.setLanguage(Locale.forLanguageTag(language));
            if (languageResult < 0) throw new Exception("This speech language is not installed");
            speech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String utteranceId) { }
                @Override public void onDone(String utteranceId) { runOnUiThread(() -> { if (utteranceId.equals(speechId)) finishSpeech(null); }); }
                @Override public void onError(String utteranceId) { runOnUiThread(() -> { if (utteranceId.equals(speechId)) finishSpeech(new Exception("Speech playback failed")); }); }
            });
            if (speech.speak(speechPayload.getString("text"), TextToSpeech.QUEUE_FLUSH, null, speechId) == TextToSpeech.ERROR) throw new Exception("Speech playback could not start");
        } catch (Exception error) { finishSpeech(error); }
    }

    private void finishSpeech(Exception error) {
        String id = speechId; speechId = null; speechPayload = null;
        if (id == null) return;
        if (error == null) resolve(id, true); else reject(id, error);
    }


}
