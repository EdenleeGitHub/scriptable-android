package dev.scriptable.android;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.UUID;

/** Per-instance script widgets rendered with a full Canvas layout instead of flattened text. */
public final class ScriptWidgetProvider extends AppWidgetProvider {
    private static final String STORE = "widget-preview";
    static final String ACTION_BOUND = "dev.scriptable.android.WIDGET_BOUND";
    static final String ACTION_REFRESH = "dev.scriptable.android.WIDGET_REFRESH";
    private static SharedPreferences store(Context context) { return context.getSharedPreferences(STORE, Context.MODE_PRIVATE); }
    private static File treeFile(Context context, String name) throws Exception { File root = new File(context.getFilesDir(), "widgets"); if (!root.isDirectory() && !root.mkdirs()) throw new Exception("Cannot open widget storage"); return new File(root, name + ".json"); }
    private static void writeTree(Context context, String name, JSONObject tree) throws Exception {
        byte[] bytes = tree.toString().getBytes(StandardCharsets.UTF_8); if (bytes.length > ScriptRepository.MAX_BYTES) throw new Exception("Widget snapshot exceeds 16 MB");
        File target = treeFile(context, name), temporary = new File(target.getParentFile(), name + ".tmp"); Files.write(temporary.toPath(), bytes); Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }
    private static JSONObject readTree(Context context, String name) {
        try { File file = treeFile(context, name); if (file.isFile() && file.length() <= ScriptRepository.MAX_BYTES) return new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8)); } catch (Exception ignored) { }
        return new JSONObject();
    }
    static synchronized Object save(Context context, JSONObject payload) throws Exception {
        JSONObject tree = payload.getJSONObject("tree"); String scriptId = payload.optString("scriptId", ""); validateScript(scriptId);
        String parameter = payload.isNull("parameter") ? "" : payload.optString("parameter", ""), family = payload.optString("family", "medium");
        int target = payload.optInt("targetWidgetId", -1);
        AppWidgetManager manager = AppWidgetManager.getInstance(context); int[] ids = manager.getAppWidgetIds(new ComponentName(context, ScriptWidgetProvider.class));
        if (target > 0) {
            boolean belongs = false; for (int id : ids) if (id == target) belongs = true;
            if (!belongs) throw new Exception("Widget instance no longer exists");
            String configured = store(context).getString("script." + target, ""); if (!configured.equals(scriptId)) throw new Exception("Widget script association changed");
            updateInstance(context, target, tree); return new JSONObject().put("saved", true).put("widgetCount", 1);
        }
        writeTree(context, "latest", tree); writeTree(context, "script-" + scriptId, tree);
        if (!store(context).edit().putString("scriptId", scriptId).putString("parameter", parameter).putString("family", family).putLong("updatedAt", System.currentTimeMillis()).commit()) throw new Exception("Widget configuration could not be saved");
        int updated = 0;
        for (int id : ids) {
            String configured = store(context).getString("script." + id, "");
            if (configured.isEmpty()) configure(context, id, scriptId, parameter, family);
            if (scriptId.equals(store(context).getString("script." + id, "")) && parameter.equals(store(context).getString("parameter." + id, "")) && family.equals(store(context).getString("family." + id, "medium"))) { updateInstance(context, id, tree); updated++; }
        }
        WidgetRefreshJob.schedule(context);
        return new JSONObject().put("saved", true).put("widgetCount", updated);
    }
    private static void validateScript(String scriptId) throws Exception { if (!scriptId.matches("[A-Za-z0-9_-]{1,80}")) throw new Exception("Select a saved script before adding its widget"); }
    static synchronized void configure(Context context, int widgetId, String scriptId, String parameter, String family) throws Exception {
        validateScript(scriptId); if (widgetId <= 0) throw new Exception("Invalid widget instance");
        if (!family.matches("small|medium|large|extraLarge|accessoryCircular|accessoryRectangular|accessoryInline")) throw new Exception("Invalid widget family");
        if (parameter == null) parameter = ""; if (parameter.length() > 4096) throw new Exception("Widget parameters may contain at most 4096 characters");
        if (!store(context).edit().putString("script." + widgetId, scriptId).putString("parameter." + widgetId, parameter).putString("family." + widgetId, family).commit()) throw new Exception("Widget association could not be saved");
        JSONObject tree = readTree(context, "script-" + scriptId); if (tree.length() > 0) writeTree(context, "instance-" + widgetId, tree);
        update(context, AppWidgetManager.getInstance(context), widgetId); WidgetRefreshJob.schedule(context); WidgetRefreshJob.request(context, new int[]{widgetId});
    }
    static synchronized void updateInstance(Context context, int widgetId, JSONObject tree) throws Exception {
        writeTree(context, "instance-" + widgetId, tree);
        long date = 0; try { date = java.time.Instant.parse(tree.optString("refreshAfterDate")).toEpochMilli(); } catch (Exception ignored) { }
        store(context).edit().putLong("updated." + widgetId, System.currentTimeMillis()).putLong("refreshAfter." + widgetId, date).apply();
        update(context, AppWidgetManager.getInstance(context), widgetId); WidgetRefreshJob.schedule(context);
    }
    static JSONArray instanceConfigs(Context context) throws Exception {
        JSONArray result = new JSONArray(); AppWidgetManager manager = AppWidgetManager.getInstance(context);
        for (int id : manager.getAppWidgetIds(new ComponentName(context, ScriptWidgetProvider.class))) {
            String scriptId = store(context).getString("script." + id, ""); if (scriptId.isEmpty()) continue;
            result.put(new JSONObject().put("widgetId", id).put("scriptId", scriptId).put("parameter", store(context).getString("parameter." + id, "")).put("family", store(context).getString("family." + id, "medium")).put("refreshAfterDate", store(context).getLong("refreshAfter." + id, 0)).put("updatedAt", store(context).getLong("updated." + id, 0)));
        }
        return result;
    }
    static Object requestPin(Context context, JSONObject payload) throws Exception {
        if (payload.has("tree")) save(context, payload);
        AppWidgetManager manager = AppWidgetManager.getInstance(context); if (!manager.isRequestPinAppWidgetSupported()) throw new Exception("This launcher does not support pinning widgets; add Scriptable from the launcher widget menu");
        String script = payload.optString("scriptId", store(context).getString("scriptId", "")); validateScript(script);
        String token = UUID.randomUUID().toString();
        JSONObject data = new JSONObject().put("scriptId", script).put("parameter", payload.optString("parameter", store(context).getString("parameter", ""))).put("family", payload.optString("family", store(context).getString("family", "medium")));
        store(context).edit().putString("pending." + token, data.toString()).apply();
        Intent bound = new Intent(context, ScriptWidgetProvider.class).setAction(ACTION_BOUND).setData(Uri.parse("scriptable-android://widget-bound/" + token)).putExtra("token", token);
        PendingIntent callback = PendingIntent.getBroadcast(context, token.hashCode(), bound, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_ONE_SHOT);
        boolean requested = manager.requestPinAppWidget(new ComponentName(context, ScriptWidgetProvider.class), null, callback);
        if (!requested) store(context).edit().remove("pending." + token).apply();
        return new JSONObject().put("requested", requested);
    }
    @Override public void onReceive(Context context, Intent intent) {
        if (ACTION_BOUND.equals(intent.getAction())) {
            String token = intent.getStringExtra("token"); String pending = token == null ? null : store(context).getString("pending." + token, null);
            if (pending == null) return; store(context).edit().remove("pending." + token).apply();
            int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
            android.appwidget.AppWidgetProviderInfo info = AppWidgetManager.getInstance(context).getAppWidgetInfo(id);
            if (info == null || !new ComponentName(context, ScriptWidgetProvider.class).equals(info.provider)) return;
            try { JSONObject data = new JSONObject(pending); if(!store(context).contains("script."+id))configure(context, id, data.getString("scriptId"), data.optString("parameter"), data.optString("family", "medium"));else WidgetRefreshJob.request(context,new int[]{id}); } catch (Exception ignored) { }
            return;
        }
        if (ACTION_REFRESH.equals(intent.getAction())) { WidgetRefreshJob.request(context, null); return; }
        super.onReceive(context, intent);
    }
    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) { if (!store(context).contains("script." + id)) { String script = store(context).getString("scriptId", ""); if (!script.isEmpty()) try { configure(context, id, script, store(context).getString("parameter", ""), store(context).getString("family", "medium")); } catch (Exception ignored) { } } update(context, manager, id); }
        WidgetRefreshJob.schedule(context); WidgetRefreshJob.request(context, ids);
    }
    @Override public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int widgetId, Bundle options) { update(context, manager, widgetId); WidgetRefreshJob.request(context, new int[]{widgetId}); }
    @Override public void onDeleted(Context context, int[] ids) {
        SharedPreferences.Editor editor = store(context).edit();
        for (int id : ids) { for (String key : new String[]{"script.", "parameter.", "family.", "updated.", "refreshAfter."}) editor.remove(key + id); try { Files.deleteIfExists(treeFile(context, "instance-" + id).toPath()); } catch (Exception ignored) { } }
        editor.apply(); WidgetRefreshJob.schedule(context);
    }
    @Override public void onRestored(Context context, int[] oldIds, int[] newIds) {
        for (int i = 0; i < Math.min(oldIds.length, newIds.length); i++) try { configure(context, newIds[i], store(context).getString("script." + oldIds[i], ""), store(context).getString("parameter." + oldIds[i], ""), store(context).getString("family." + oldIds[i], "medium")); JSONObject tree = readTree(context, "instance-" + oldIds[i]); if (tree.length() > 0) updateInstance(context, newIds[i], tree); } catch (Exception ignored) { }
    }
    static void refreshNow(Context context) { WidgetRefreshJob.request(context, null); }

    private static void update(Context context, AppWidgetManager manager, int id) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget);
        String scriptId = store(context).getString("script." + id, ""), parameter = store(context).getString("parameter." + id, ""), family = store(context).getString("family." + id, "medium");
        JSONObject tree = readTree(context, "instance-" + id);
        try {
            if (tree.length() == 0) tree = new JSONObject().put("type", "widget").put("layout", "vertical").put("backgroundColor", "#F4F6FB").put("children", new JSONArray().put(new JSONObject().put("type", "text").put("text", "打开 Scriptable Android\n选择并运行小组件脚本").put("textColor", "#202B40").put("font", new JSONObject().put("size", 16))));
            Bundle options = manager.getAppWidgetOptions(id); int width = Math.max(64, Math.min(900, options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, "small".equals(family) ? 160 : 320))), height = Math.max(48, Math.min(900, options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, "large".equals(family) ? 320 : 160)));
            WidgetRenderer.Result result = WidgetRenderer.render(tree, width, height, context.getResources().getDisplayMetrics().density);
            views.setImageViewBitmap(R.id.widget_content, result.bitmap); views.removeAllViews(R.id.widget_hotspots); views.removeAllViews(R.id.widget_live_dates);
            float density = context.getResources().getDisplayMetrics().density;
            long now = System.currentTimeMillis(), elapsed = android.os.SystemClock.elapsedRealtime();
            for (WidgetRenderer.DynamicDate date : result.dynamicDates) {
                RemoteViews timer = new RemoteViews(context.getPackageName(), R.layout.widget_timer);
                timer.setViewPadding(R.id.widget_live_timer, Math.max(0, Math.round(date.rectangle.left * density)), Math.max(0, Math.round(date.rectangle.top * density)), Math.max(0, Math.round((width - date.rectangle.right) * density)), Math.max(0, Math.round((height - date.rectangle.bottom) * density)));
                timer.setTextColor(R.id.widget_live_timer, date.textColor);
                timer.setTextViewTextSize(R.id.widget_live_timer, android.util.TypedValue.COMPLEX_UNIT_DIP, date.fontSize);
                timer.setInt(R.id.widget_live_timer, "setGravity", android.view.Gravity.TOP | ("center".equals(date.alignment) ? android.view.Gravity.CENTER_HORIZONTAL : "right".equals(date.alignment) ? android.view.Gravity.RIGHT : android.view.Gravity.LEFT));
                timer.setChronometerCountDown(R.id.widget_live_timer, date.dateEpoch > now);
                timer.setChronometer(R.id.widget_live_timer, elapsed + (date.dateEpoch - now), null, true);
                views.addView(R.id.widget_live_dates, timer);
            }
            // RemoteViews have no arbitrary-position hit regions. A transparent 8x8 grid preserves links.
            for (int row = 0; row < 8; row++) {
                RemoteViews strip = new RemoteViews(context.getPackageName(), R.layout.widget_hit_row);
                for (int column = 0; column < 8; column++) {
                    RemoteViews cell = new RemoteViews(context.getPackageName(), R.layout.widget_hit_cell);
                    String url = result.urlAt((column + .5f) * width / 8, (row + .5f) * height / 8);
                    Intent intent;
                    if (url != null && allowedURL(url)) intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE);
                    else intent = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP).setData(Uri.parse("scriptable-android://run?id=" + Uri.encode(scriptId) + "&widgetParameter=" + Uri.encode(parameter) + "&widgetFamily=" + Uri.encode(family)));
                    PendingIntent click = PendingIntent.getActivity(context, id * 64 + row * 8 + column, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                    cell.setOnClickPendingIntent(R.id.widget_hit_cell, click); strip.addView(R.id.widget_hit_row, cell);
                }
                views.addView(R.id.widget_hotspots, strip);
            }
            manager.updateAppWidget(id, views);
        } catch (Exception ignored) { }
    }
    private static boolean allowedURL(String url) { String scheme = Uri.parse(url).getScheme(); return scheme != null && !scheme.matches("(?i)javascript|data|file|content|intent"); }
}
