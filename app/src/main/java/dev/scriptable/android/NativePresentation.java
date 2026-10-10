package dev.scriptable.android;

import android.app.Activity;
import android.app.Dialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.ConsoleMessage;
import android.webkit.MimeTypeMap;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.File;
import java.io.FileInputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Script-owned presentation surfaces. A remote page never receives an Android JS interface. */
final class NativePresentation {
    interface Callback {
        void resolve(String id, Object value);
        void reject(String id, Exception error);
        void event(String id, JSONObject event);
    }
    private final Activity activity;
    private final Callback callback;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<String, BrowserState> browsers = new HashMap<>();
    private final Map<String, TableState> tables = new HashMap<>();
    private final Map<String, String> callbacks = new HashMap<>();
    private final Set<String> requests = new HashSet<>();
    private final Map<String, String> requestOwners = new HashMap<>();
    private final java.util.concurrent.ExecutorService imageExecutor = java.util.concurrent.Executors.newFixedThreadPool(2);
    private boolean closed;

    NativePresentation(Activity activity, Callback callback) { this.activity = activity; this.callback = callback; }
    boolean handles(String action) { return action.startsWith("webview.") || action.equals("table.present") || action.equals("table.reload") || action.equals("safari.present") || action.equals("callback.open") || action.equals("url.open"); }
    void handle(String id, String action, JSONObject payload, String runId) { requestOwners.put(id, runId == null ? "" : runId); handle(id, action, payload); }
    void handle(String id, String action, JSONObject payload) {
        requests.add(id);
        try {
            if (closed) throw new Exception("Presentation host is closed");
            switch (action) {
                case "webview.load": load(id, payload); break;
                case "webview.evaluate": evaluate(id, payload); break;
                case "webview.present": present(id, browser(payload), payload.optBoolean("fullscreen")); break;
                case "webview.wait": browser(payload).waiters.add(id); break;
                case "webview.navigate": navigate(id, payload); break;
                case "webview.close": { BrowserState state = browsers.remove(payload.getString("webviewId")); if (state != null) destroy(state, "WebView closed"); resolve(id, null); break; }
                case "table.present": table(id, payload); break;
                case "table.reload": { TableState state = tables.get(payload.getString("tableId")); if (state != null) { state.payload = payload; renderTable(state); } resolve(id, null); break; }
                case "safari.present": { String key = "safari-" + UUID.randomUUID(); JSONObject data = new JSONObject().put("webviewId", key).put("mode", "url").put("url", payload.getString("url")); BrowserState state = create(key); state.runId = requestOwners.get(id); state.web.loadUrl(httpURL(data.getString("url"))); present(id, state, payload.optBoolean("fullscreen")); break; }
                case "callback.open": openCallback(id, payload); break;
                case "url.open": launch(payload.getString("url")); resolve(id, true); break;
                default: throw new Exception("Unknown presentation action: " + action);
            }
        } catch (Exception error) { reject(id, error); }
    }

    private void resolve(String id, Object result) { if (id != null && requests.remove(id)) { requestOwners.remove(id); callback.resolve(id, result); } }
    private void reject(String id, Exception error) { if (id != null && requests.remove(id)) { requestOwners.remove(id); callback.reject(id, error); } }
    private void emit(String id, JSONObject event) { if (id != null && !closed) callback.event(id, event); }
    private int dp(double value) { return Math.round((float) value * activity.getResources().getDisplayMetrics().density); }
    private String httpURL(String value) throws Exception { Uri uri = Uri.parse(value); if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme())) || uri.getHost() == null) throw new Exception("WebView URLs must use HTTP or HTTPS"); return value; }

    private static final class BrowserState {
        String key, loadingId, presentId, evaluatingId, runId, ownerEventId;
        WebView web;
        Dialog dialog;
        boolean intercept, destroyed;
        volatile boolean privateFiles;
        final ArrayList<String> waiters = new ArrayList<>();
        final Map<String, String> navigations = new HashMap<>();
        String eventId() { return presentId != null ? presentId : loadingId != null ? loadingId : evaluatingId != null ? evaluatingId : waiters.isEmpty() ? ownerEventId : waiters.get(0); }
    }
    private BrowserState browser(JSONObject payload) throws Exception { BrowserState state = browsers.get(payload.getString("webviewId")); if (state == null) throw new Exception("Load content into the WebView first"); return state; }
    private BrowserState create(String key) {
        BrowserState state = new BrowserState(); state.key = key; state.web = new WebView(activity);
        WebSettings settings = state.web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false); settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false); settings.setSupportMultipleWindows(false);
        state.web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                try { emit(state.eventId(), new JSONObject().put("type", "webLog").put("error", message.messageLevel() == ConsoleMessage.MessageLevel.ERROR).put("values", new JSONArray().put(message.message()))); } catch (Exception ignored) { }
                return true;
            }
        });
        state.web.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                if (!"scriptable-files.invalid".equals(Uri.parse(url).getHost())) state.privateFiles = false;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                String url = request.getUrl().toString(), scheme = request.getUrl().getScheme();
                if (state.intercept && state.eventId() != null) {
                    String navigation = UUID.randomUUID().toString(); state.navigations.put(navigation, url);
                    try {
                        JSONObject headers = new JSONObject(request.getRequestHeaders());
                        emit(state.eventId(), new JSONObject().put("type", "navigation").put("webviewId", state.key).put("navigationId", navigation).put("url", url).put("method", request.getMethod()).put("headers", headers));
                    } catch (Exception ignored) { }
                    return true;
                }
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) return false;
                if ("about".equalsIgnoreCase(scheme)) return false;
                try { launch(url); } catch (Exception ignored) { }
                return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                resolve(state.loadingId, null); state.loadingId = null;
                for (String id : new ArrayList<>(state.waiters)) resolve(id, null);
                state.waiters.clear();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                failLoad(state, new Exception("WebView load failed: " + error.getDescription()));
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!"scriptable-files.invalid".equals(request.getUrl().getHost())) return null;
                try {
                    if (!state.privateFiles) throw new Exception("Private files are unavailable to remote pages");
                    File file = privateFile(request.getUrl().getPath());
                    String filename = file.getName(); int dot = filename.lastIndexOf('.');
                    String extension = dot < 0 ? "" : filename.substring(dot + 1).toLowerCase(java.util.Locale.ROOT);
                    String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
                    return new WebResourceResponse(mime == null ? "application/octet-stream" : mime, "UTF-8", new FileInputStream(file));
                } catch (Exception error) { return new WebResourceResponse("text/plain", "UTF-8", 404, "Not found", new HashMap<>(), new java.io.ByteArrayInputStream("Private file not found".getBytes(java.nio.charset.StandardCharsets.UTF_8))); }
            }
        });
        browsers.put(key, state); return state;
    }
    private void failLoad(BrowserState state, Exception error) {
        reject(state.loadingId, error); state.loadingId = null;
        for (String id : new ArrayList<>(state.waiters)) reject(id, error);
        state.waiters.clear();
    }
    private File privateFile(String input) throws Exception {
        if (input == null) throw new Exception("Missing private path");
        String path = input.replace('\\', '/');
        if (path.startsWith("file://")) path = Uri.parse(path).getPath();
        if (!path.matches("/(documents|cache|temporary|library)(/.*)?")) throw new Exception("WebView files must be in private Scriptable storage");
        File root = new File(activity.getFilesDir(), "script-files").getCanonicalFile();
        File file = new File(root, path.substring(1)).getCanonicalFile();
        if (!file.getPath().startsWith(root.getPath() + File.separator) || !file.isFile() || file.length() > ScriptRepository.MAX_BYTES) throw new Exception("Invalid or missing private file");
        return file;
    }
    private void load(String id, JSONObject payload) throws Exception {
        String key = payload.getString("webviewId");
        if (browsers.size() >= 8 && !browsers.containsKey(key)) throw new Exception("A script can create at most eight WebViews");
        BrowserState state = browsers.get(key); if (state == null) state = create(key);
        state.runId = requestOwners.get(id);
        if (state.loadingId != null) reject(state.loadingId, new Exception("WebView load was superseded"));
        state.loadingId = id; state.intercept = payload.optBoolean("interceptNavigation");
        state.ownerEventId = id;
        BrowserState loaded = state;
        handler.postDelayed(() -> { if (id.equals(loaded.loadingId)) { loaded.web.stopLoading(); failLoad(loaded, new Exception("WebView load timed out")); } }, 60000);
        switch (payload.getString("mode")) {
            case "url": state.privateFiles = false; state.web.loadUrl(httpURL(payload.getString("url"))); break;
            case "html": {
                state.privateFiles = false;
                String base = payload.optString("baseURL", "");
                if (!base.isEmpty() && !"null".equals(base)) httpURL(base);
                String html = payload.getString("html");
                if (html.length() > ScriptRepository.MAX_BYTES) throw new Exception("HTML exceeds 4 MB");
                state.web.loadDataWithBaseURL(base.isEmpty() || "null".equals(base) ? "https://scriptable-page.invalid/" : base, html, "text/html", "UTF-8", null); break;
            }
            case "file": privateFile(payload.getString("path")); state.privateFiles = true; state.web.loadUrl("https://scriptable-files.invalid" + payload.getString("path").replace("file://", "")); break;
            default: throw new Exception("Invalid WebView load mode");
        }
    }
    private void navigate(String id, JSONObject payload) throws Exception {
        BrowserState state = browser(payload); String url = state.navigations.remove(payload.getString("navigationId"));
        if (url != null && payload.optBoolean("allow")) {
            Uri uri = Uri.parse(url);
            if ("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme())) state.web.loadUrl(url);
            else launch(url);
        }
        resolve(id, null);
    }

    private void evaluate(String id, JSONObject payload) throws Exception {
        BrowserState state = browser(payload); String code = payload.getString("javaScript");
        if (code.length() > ScriptRepository.MAX_SCRIPT_BYTES) throw new Exception("Evaluation exceeds 1 MB");
        if (state.evaluatingId != null) throw new Exception("Wait for the previous JavaScript evaluation to finish");
        state.evaluatingId = id;
        String slot = "__scriptable_completion_" + UUID.randomUUID().toString().replace("-", "");
        boolean completion = payload.optBoolean("useCallback");
        String setup = "window.log=console.log.bind(console);window.logError=console.error.bind(console);";
        String wrapped = completion ? "(function(){" + setup + "window[" + JSONObject.quote(slot) + "]={done:false};window.completion=function(v){try{window[" + JSONObject.quote(slot) + "]={done:true,ok:true,value:JSON.parse(JSON.stringify(v===undefined?null:v))}}catch(e){window[" + JSONObject.quote(slot) + "]={done:true,ok:false,error:String(e)}}};try{(0,eval)(" + JSONObject.quote(code) + ")}catch(e){window[" + JSONObject.quote(slot) + "]={done:true,ok:false,error:String(e)}}return true})()" : "(function(){" + setup + "try{return JSON.stringify({ok:true,value:(0,eval)(" + JSONObject.quote(code) + ")})}catch(e){return JSON.stringify({ok:false,error:String(e)})}})()";
        state.web.evaluateJavascript(wrapped, value -> {
            if (!requests.contains(id)) return;
            if (completion) pollEvaluation(state, id, slot, System.currentTimeMillis() + 120000);
            else finishEvaluation(state, id, value, true);
        });
    }
    private void pollEvaluation(BrowserState state, String id, String slot, long deadline) {
        if (closed || !requests.contains(id)) return;
        if (System.currentTimeMillis() > deadline) { state.evaluatingId = null; reject(id, new Exception("completion(value) was not called within two minutes")); return; }
        state.web.evaluateJavascript("JSON.stringify(window[" + JSONObject.quote(slot) + "]||{done:false})", value -> {
            if (!requests.contains(id)) return;
            try {
                Object decoded = new JSONTokener(value).nextValue();
                JSONObject result = new JSONObject(String.valueOf(decoded));
                if (result.optBoolean("done")) { state.web.evaluateJavascript("delete window[" + JSONObject.quote(slot) + "]", null); finishEvaluation(state, id, value, true); }
                else handler.postDelayed(() -> pollEvaluation(state, id, slot, deadline), 50);
            } catch (Exception error) { state.evaluatingId = null; reject(id, new Exception("WebView evaluation context was lost", error)); }
        });
    }
    private void finishEvaluation(BrowserState state, String id, String encoded, boolean nested) {
        state.evaluatingId = null;
        try {
            Object decoded = new JSONTokener(encoded).nextValue();
            JSONObject result = new JSONObject(String.valueOf(decoded));
            if (!result.optBoolean("ok")) throw new Exception(result.optString("error", "JavaScript evaluation failed"));
            resolve(id, result.opt("value"));
        } catch (Exception error) { reject(id, error); }
    }
    private Dialog surface(View content, boolean fullscreen, Runnable dismissed) {
        Dialog dialog = new Dialog(activity); dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout container = new LinearLayout(activity); container.setOrientation(LinearLayout.VERTICAL); container.setBackgroundColor(android.graphics.Color.WHITE);
        LinearLayout toolbar = new LinearLayout(activity); toolbar.setGravity(Gravity.END | Gravity.CENTER_VERTICAL); toolbar.setPadding(dp(8), dp(4), dp(8), dp(4));
        Button done = new Button(activity); done.setText("完成"); done.setOnClickListener(view -> dialog.dismiss()); toolbar.addView(done);
        container.addView(toolbar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        container.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        dialog.setContentView(container); dialog.setOnDismissListener(view -> dismissed.run()); dialog.show();
        Window window = dialog.getWindow(); if (window != null) { window.setBackgroundDrawable(new ColorDrawable(android.graphics.Color.TRANSPARENT)); window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, fullscreen ? ViewGroup.LayoutParams.MATCH_PARENT : Math.round(activity.getResources().getDisplayMetrics().heightPixels * .88f)); window.setGravity(fullscreen ? Gravity.CENTER : Gravity.BOTTOM); }
        return dialog;
    }
    private void present(String id, BrowserState state, boolean fullscreen) throws Exception {
        if (state.dialog != null) throw new Exception("This WebView is already presented");
        if (state.web.getParent() instanceof ViewGroup) ((ViewGroup) state.web.getParent()).removeView(state.web);
        state.presentId = id;
        state.dialog = surface(state.web, fullscreen, () -> { state.dialog = null; state.presentId = null; if (state.web.getParent() instanceof ViewGroup) ((ViewGroup) state.web.getParent()).removeView(state.web); resolve(id, null); if (state.key.startsWith("safari-")) { browsers.remove(state.key); destroy(state, "Browser closed"); } });
    }
    private static final class TableState {
        String id, key, runId; JSONObject payload; Dialog dialog; LinearLayout rows;
    }
    private void table(String id, JSONObject payload) throws Exception {
        String key = payload.getString("tableId"); if (tables.containsKey(key)) throw new Exception("Table is already presented");
        if (tables.size() >= 4) throw new Exception("At most four tables can be presented");
        TableState state = new TableState(); state.id = id; state.key = key; state.runId = requestOwners.get(id); state.payload = payload;
        state.rows = new LinearLayout(activity); state.rows.setOrientation(LinearLayout.VERTICAL);
        ScrollView scroll = new ScrollView(activity); scroll.addView(state.rows); tables.put(key, state); renderTable(state);
        state.dialog = surface(scroll, payload.optBoolean("fullscreen"), () -> { tables.remove(key); resolve(id, null); });
    }
    private void renderTable(TableState state) throws Exception {
        state.rows.removeAllViews(); JSONArray rows = state.payload.optJSONArray("rows"); if (rows == null) return;
        if (rows.length() > 500) throw new Exception("Tables can contain at most 500 rows");
        for (int index = 0; index < rows.length(); index++) {
            JSONObject row = rows.getJSONObject(index); int position = index;
            LinearLayout rowView = new LinearLayout(activity); rowView.setGravity(Gravity.CENTER_VERTICAL); rowView.setPadding(dp(12), dp(6), dp(12), dp(6));
            rowView.setBackgroundColor(WidgetRenderer.color(NativeJson.string(row,"backgroundColor", row.optBoolean("isHeader") ? "#F0F2F6" : "#FFFFFF"), android.graphics.Color.WHITE));
            JSONArray cells = row.optJSONArray("cells"); if (cells == null) cells = new JSONArray();
            for (int j = 0; j < Math.min(50, cells.length()); j++) {
                JSONObject cell = cells.getJSONObject(j); View item;
                if ("image".equals(cell.optString("type"))) {
                    ImageView image = new ImageView(activity); image.setScaleType(ImageView.ScaleType.FIT_CENTER); image.setAdjustViewBounds(true);
                    Bitmap bitmap = WidgetRenderer.decodeImage(cell.optString("image")); if (bitmap != null) image.setImageBitmap(bitmap);
                    else if (NativeJson.hasValue(cell,"imageURL")) loadTableImage(image, cell.optString("imageURL"), state);
                    item = image;
                } else {
                    LinearLayout text = new LinearLayout(activity); text.setOrientation(LinearLayout.VERTICAL); text.setGravity(cellGravity(cell));
                    TextView title = new TextView(activity); title.setText(cell.optString("title")); title.setGravity(cellGravity(cell)); title.setTextColor(WidgetRenderer.color(NativeJson.string(cell,"titleColor", "button".equals(cell.optString("type")) ? "#007AFF" : "#202B40"), android.graphics.Color.BLACK));
                    font(title, cell.optJSONObject("titleFont"), row.optBoolean("isHeader") ? 16 : 17, row.optBoolean("isHeader")); text.addView(title);
                    if (!NativeJson.string(cell,"subtitle", "").isEmpty()) { TextView subtitle = new TextView(activity); subtitle.setText(cell.optString("subtitle")); subtitle.setGravity(cellGravity(cell)); subtitle.setTextColor(WidgetRenderer.color(NativeJson.string(cell,"subtitleColor", "#61718A"), android.graphics.Color.GRAY)); font(subtitle, cell.optJSONObject("subtitleFont"), 13, false); text.addView(subtitle); }
                    item = text;
                }
                LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, (float) Math.max(.01, cell.optDouble("widthWeight", 1))); if (j > 0) size.leftMargin = dp(Math.max(0, row.optDouble("cellSpacing"))); rowView.addView(item, size);
                if (cell.optBoolean("tappable")) item.setOnClickListener(view -> selection(state, row, cell, position));
            }
            state.rows.addView(rowView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(Math.max(24, Math.min(1200, row.optDouble("height", 44))))));
            if (row.optBoolean("selectable")) rowView.setOnClickListener(view -> selection(state, row, null, position));
            if (state.payload.optBoolean("showSeparators")) { View line = new View(activity); line.setBackgroundColor(0xFFE0E5ED); state.rows.addView(line, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1))); }
        }
    }
    private void selection(TableState state, JSONObject row, JSONObject cell, int index) {
        try {
            JSONObject event = new JSONObject().put("type", cell == null ? "select" : "tap").put("tableId", state.key).put("rowId", row.getString("rowId")).put("index", index);
            if (cell != null) event.put("cellId", cell.getString("cellId")); emit(state.id, event);
            if (cell == null ? row.optBoolean("dismissOnSelect", true) : cell.optBoolean("dismissOnTap")) handler.postDelayed(() -> { if (state.dialog != null) state.dialog.dismiss(); }, 80);
        } catch (Exception error) { reject(state.id, error); }
    }
    private int cellGravity(JSONObject cell) { return Gravity.CENTER_VERTICAL | ("center".equals(cell.optString("alignment")) ? Gravity.CENTER_HORIZONTAL : "right".equals(cell.optString("alignment")) ? Gravity.RIGHT : Gravity.LEFT); }
    private void font(TextView view, JSONObject font, int fallback, boolean header) {
        view.setTextSize((float) Math.max(6, Math.min(128, font == null ? fallback : font.optDouble("size", fallback))));
        view.setTypeface(WidgetRenderer.typeface(font), header || font != null && (font.optString("weight").equals("bold") || font.optDouble("weight", 0) >= 600) ? Typeface.BOLD : Typeface.NORMAL);
    }
    private void loadTableImage(ImageView target, String url, TableState state) {
        // Network work is isolated from the main thread and cannot call the privileged host bridge.
        imageExecutor.execute(() -> { java.net.HttpURLConnection connection = null; try {
            httpURL(url); connection = (java.net.HttpURLConnection) new java.net.URL(url).openConnection(); connection.setConnectTimeout(10000); connection.setReadTimeout(10000); connection.setInstanceFollowRedirects(false);
            if (connection.getResponseCode() != 200) return;
            byte[] bytes = ScriptRepository.readStream(connection.getInputStream(), ScriptRepository.MAX_BYTES);
            BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true; BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options); if (options.outWidth <= 0 || options.outHeight <= 0 || (long) options.outWidth * options.outHeight > 16000000) return;
            options.inJustDecodeBounds = false; options.inSampleSize = Math.max(1, Math.max(options.outWidth, options.outHeight) / 512); Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
            handler.post(() -> { if (!closed && tables.get(state.key) == state && bitmap != null) target.setImageBitmap(bitmap); });
        } catch (Exception ignored) { } finally { if (connection != null) connection.disconnect(); } });
    }
    private void launch(String url) throws Exception {
        Uri uri = Uri.parse(url); String scheme = uri.getScheme();
        if (scheme == null || !scheme.matches("[A-Za-z][A-Za-z0-9+.-]*") || scheme.equalsIgnoreCase("javascript") || scheme.equalsIgnoreCase("file") || scheme.equalsIgnoreCase("data") || scheme.equalsIgnoreCase("content") || scheme.equalsIgnoreCase("intent")) throw new Exception("Unsupported app URL scheme");
        Intent intent = new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE);
        try { activity.startActivity(intent); } catch (android.content.ActivityNotFoundException error) { throw new Exception("No installed Android app can open this URL", error); }
    }
    private void openCallback(String id, JSONObject payload) throws Exception {
        String token = UUID.randomUUID().toString(); Uri.Builder target = Uri.parse(payload.getString("url")).buildUpon();
        String base = "scriptable-android://callback?token=" + Uri.encode(token);
        target.appendQueryParameter("x-source", "Scriptable Android"); target.appendQueryParameter("x-success", base + "&status=success"); target.appendQueryParameter("x-error", base + "&status=error"); target.appendQueryParameter("x-cancel", base + "&status=cancel");
        callbacks.put(token, id);
        try { launch(target.build().toString()); } catch (Exception error) { callbacks.remove(token); throw error; }
        handler.postDelayed(() -> { if (id.equals(callbacks.remove(token))) reject(id, new Exception("The target app did not invoke its callback within two minutes")); }, 120000);
    }
    boolean onIntent(Intent intent) {
        Uri uri = intent == null ? null : intent.getData();
        if (uri == null || !"scriptable-android".equals(uri.getScheme()) || !"callback".equals(uri.getHost())) return false;
        String id = callbacks.remove(uri.getQueryParameter("token")); if (id == null) return true;
        try {
            String status = uri.getQueryParameter("status");
            if (!"success".equals(status)) throw new Exception("cancel".equals(status) ? "Callback action was cancelled" : uri.getQueryParameter("errorMessage") == null ? "Callback action failed" : uri.getQueryParameter("errorMessage"));
            JSONObject result = new JSONObject(); for (String key : uri.getQueryParameterNames()) if (!key.equals("token") && !key.equals("status")) result.put(key, uri.getQueryParameter(key)); resolve(id, result);
        } catch (Exception error) { reject(id, error); }
        return true;
    }
    private void destroy(BrowserState state, String reason) {
        if (state.destroyed) return; state.destroyed = true;
        reject(state.loadingId, new Exception(reason)); reject(state.evaluatingId, new Exception(reason));
        for (String id : state.waiters) reject(id, new Exception(reason)); state.waiters.clear();
        if (state.dialog != null) state.dialog.dismiss();
        state.web.stopLoading(); if (state.web.getParent() instanceof ViewGroup) ((ViewGroup) state.web.getParent()).removeView(state.web); state.web.destroy();
    }
    void cancel(Set<String> ids) {
        Set<String> runs = new HashSet<>(); for (String id : ids) if (requestOwners.containsKey(id)) runs.add(requestOwners.get(id));
        for (TableState state : new ArrayList<>(tables.values())) if (ids.contains(state.id) && state.dialog != null) state.dialog.dismiss();
        for (BrowserState state : new ArrayList<>(browsers.values())) if (ids.contains(state.loadingId) || ids.contains(state.presentId) || ids.contains(state.evaluatingId) || state.waiters.stream().anyMatch(ids::contains)) { browsers.remove(state.key); destroy(state, "Script execution was stopped"); }
        callbacks.entrySet().removeIf(entry -> ids.contains(entry.getValue()));
        for (String id : ids) reject(id, new Exception("Script execution was stopped"));
        for (String runId : runs) finishRun(runId);
    }
    void finishRun(String runId) {
        if (runId == null || runId.isEmpty()) return;
        for (TableState state : new ArrayList<>(tables.values())) if (runId.equals(state.runId) && state.dialog != null) state.dialog.dismiss();
        for (BrowserState state : new ArrayList<>(browsers.values())) if (runId.equals(state.runId)) { browsers.remove(state.key); destroy(state, "Script execution finished"); }
        for (String id : new ArrayList<>(requests)) if (runId.equals(requestOwners.get(id))) reject(id, new Exception("Script execution finished"));
        callbacks.entrySet().removeIf(entry -> !requests.contains(entry.getValue()));
    }
    void close() {
        closed = true;
        imageExecutor.shutdownNow();
        for (TableState state : new ArrayList<>(tables.values())) if (state.dialog != null) state.dialog.dismiss(); tables.clear();
        for (BrowserState state : new ArrayList<>(browsers.values())) destroy(state, "Presentation host closed"); browsers.clear(); callbacks.clear();
        for (String id : new ArrayList<>(requests)) reject(id, new Exception("Presentation host closed"));
    }
}
