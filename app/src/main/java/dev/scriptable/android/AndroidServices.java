package dev.scriptable.android;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.content.ClipData;
import android.content.ContentProvider;
import android.content.ContentProviderOperation;
import android.content.ContentProviderResult;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.location.Address;
import android.location.Geocoder;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.provider.CalendarContract;
import android.provider.ContactsContract;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.speech.RecognizerIntent;
import android.text.Html;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.NumberPicker;
import android.widget.TextView;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** Real Android providers and user-mediated intents. No permissions are requested at startup. */
@android.annotation.SuppressLint("MissingPermission")
public final class AndroidServices {
    public interface Callback { void resolve(String id, Object result); void reject(String id, Exception error); }
    private interface Job { Object run() throws Exception; }
    private final Activity activity;
    private final Context context;
    private final Callback callback;
    private final ContentResolver resolver;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newFixedThreadPool(2);
    private final Set<String> active = ConcurrentHashMap.newKeySet();
    private final Map<String, Future<?>> jobs = new ConcurrentHashMap<>();
    private final Map<String, javax.net.ssl.HttpsURLConnection> geocodeConnections = new ConcurrentHashMap<>();
    private final Map<Integer, PendingAction> requests = new HashMap<>();
    private final Map<String, AlertDialog> dialogs = new HashMap<>();
    private final Map<String, LocationListener> locations = new HashMap<>();
    private int nextRequest = 1200;
    private int permissionRequest = -1;
    private boolean closed;
    private android.hardware.SensorManager sensorManager;
    private android.hardware.SensorEventListener sensorListener;
    private static volatile float facingX, facingY, facingZ;
    private static volatile long facingAt;
    private static java.lang.ref.WeakReference<AndroidServices> facingSource = new java.lang.ref.WeakReference<>(null);
    private static final int MAX_BYTES = 3 * 1024 * 1024;
    private static final Set<String> ACTIONS = new HashSet<>(Arrays.asList(
            "location.current", "location.reverseGeocode", "location.backgroundAccess", "location.configureGeocoding", "calendar.list", "calendar.save", "calendar.remove", "calendar.picker",
            "event.list", "event.save", "event.remove", "event.edit", "reminder.list", "reminder.save", "reminder.remove",
            "contacts.containers", "contacts.groups", "contacts.list", "contacts.persist", "photos.pick", "photos.camera",
            "photos.latest", "photos.remove", "photos.save", "documents.open", "documents.export", "dictation.start", "date.pick",
            "compose.mail", "compose.message", "device.setBrightness", "clipboard.writeImage", "sharing.present", "document.preview"));
    private static final class PendingAction {
        final String id, action; final JSONObject payload; Uri uri; byte[] bytes; List<Uri> uris; int photoIndex;
        PendingAction(String id, String action, JSONObject payload) { this.id = id; this.action = action; this.payload = payload; }
    }

    public AndroidServices(MainActivity activity, Callback callback) {
        this((Context) activity, callback);
    }
    public AndroidServices(Context context, Callback callback) {
        this.context = context; this.activity = context instanceof Activity ? (Activity) context : null;
        this.callback = callback; this.resolver = context.getContentResolver();
        File shared = new File(context.getFilesDir(), "shared");
        File[] old = shared.listFiles();
        if (old != null) for (File file : old) if (file.isFile() && !file.getName().contains("-clipboard-image.") && file.lastModified() < System.currentTimeMillis() - 86400000L) file.delete();
        if (activity != null) startOrientationSensor();
    }
    private void startOrientationSensor() {
        sensorManager = (android.hardware.SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager == null) return;
        android.hardware.Sensor gravity = sensorManager.getDefaultSensor(android.hardware.Sensor.TYPE_GRAVITY);
        boolean filtered = gravity == null;
        if (gravity == null) gravity = sensorManager.getDefaultSensor(android.hardware.Sensor.TYPE_ACCELEROMETER);
        if (gravity == null) return;
        sensorListener = new android.hardware.SensorEventListener() {
            private float x, y, z; private boolean first = true;
            @Override public void onSensorChanged(android.hardware.SensorEvent event) {
                if (closed || event.values.length < 3) return;
                if (first || !filtered) { x = event.values[0]; y = event.values[1]; z = event.values[2]; first = false; }
                else { x = .8f * x + .2f * event.values[0]; y = .8f * y + .2f * event.values[1]; z = .8f * z + .2f * event.values[2]; }
                facingX = x; facingY = y; facingZ = z; facingAt = android.os.SystemClock.elapsedRealtime(); facingSource = new java.lang.ref.WeakReference<>(AndroidServices.this);
            }
            @Override public void onAccuracyChanged(android.hardware.Sensor sensor, int accuracy) {}
        };
        sensorManager.registerListener(sensorListener, gravity, android.hardware.SensorManager.SENSOR_DELAY_NORMAL, main);
    }
    public boolean handles(String action) { return ACTIONS.contains(action); }
    public void call(String id, String action, JSONObject payload) {
        if (closed) { callback.reject(id, new Exception("The activity is closed")); return; }
        active.add(id);
        try { dispatch(new PendingAction(id, action, payload)); } catch (Exception error) { fail(id, error); }
    }
    private void finish(String id, Object value) {
        main.post(() -> { if (!active.remove(id) || closed) return; jobs.remove(id); stopLocation(id); callback.resolve(id, value); });
    }
    private void fail(String id, Exception error) {
        main.post(() -> { if (!active.remove(id) || closed) return; jobs.remove(id); stopLocation(id); callback.reject(id, error); });
    }
    private void stopLocation(String id) { LocationListener listener = locations.remove(id); if (listener != null) try { ((LocationManager) context.getSystemService(Context.LOCATION_SERVICE)).removeUpdates(listener); } catch (Exception ignored) {} }
    private void background(PendingAction request, Job job) {
        jobs.put(request.id, executor.submit(() -> {
            if (!active.contains(request.id)) return;
            try { Object value = job.run(); if (value != Deferred.INSTANCE && !Thread.currentThread().isInterrupted()) finish(request.id, value); }
            catch (Exception error) { fail(request.id, error); }
        }));
    }
    private boolean granted(String permission) { return context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED; }
    private boolean permission(PendingAction request, String... permissions) throws Exception {
        List<String> needed = new ArrayList<>(); for (String value : permissions) if (!granted(value)) needed.add(value);
        if (needed.isEmpty()) return true;
        if (activity == null) throw new Exception("Open the app and grant " + needed + " before running this API in a widget.");
        if (permissionRequest != -1) throw new Exception("Another script API permission request is open. Retry after it closes.");
        int code = nextRequest++; permissionRequest = code; requests.put(code, request);
        activity.requestPermissions(needed.toArray(new String[0]), code); return false;
    }
    private void dispatch(PendingAction r) throws Exception {
        if (!active.contains(r.id)) return;
        if (activity == null && Arrays.asList("location.backgroundAccess", "calendar.picker", "event.edit", "photos.pick", "photos.camera", "photos.remove", "documents.open", "documents.export", "dictation.start", "date.pick", "compose.mail", "compose.message", "device.setBrightness", "clipboard.writeImage", "sharing.present", "document.preview").contains(r.action))
            throw new Exception(r.action + " requires opening the app.");
        switch (r.action) {
            case "location.current":
                if (!granted(Manifest.permission.ACCESS_FINE_LOCATION) && !granted(Manifest.permission.ACCESS_COARSE_LOCATION)) {
                    if (!permission(r, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)) return;
                }
                currentLocation(r); break;
            case "location.reverseGeocode": background(r, () -> reverseGeocode(r.id, r.payload)); break;
            case "location.configureGeocoding": {
                String endpoint = r.payload.optString("endpoint");
                if (!endpoint.isEmpty()) {
                    Uri uri = Uri.parse(endpoint);
                    if (endpoint.length() > 4096 || !"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null) throw new Exception("Geocoding provider must be an HTTPS endpoint without embedded credentials or fragments");
                }
                if (!context.getSharedPreferences("location", Context.MODE_PRIVATE).edit().putString("geocodingProvider", endpoint).commit()) throw new Exception("Geocoding provider could not be saved");
                finish(r.id, new JSONObject().put("configured", !endpoint.isEmpty()).put("usesNetwork", !endpoint.isEmpty())); break;
            }
            case "location.backgroundAccess": {
                if (!granted(Manifest.permission.ACCESS_COARSE_LOCATION) && !granted(Manifest.permission.ACCESS_FINE_LOCATION) && !permission(r, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)) return;
                if (Build.VERSION.SDK_INT < 29 || granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) { finish(r.id, new JSONObject().put("opened", false).put("granted", true)); break; }
                AlertDialog dialog = new AlertDialog.Builder(activity).setTitle("桌面组件后台定位")
                        .setMessage("在接下来的安卓权限设置中选择定位权限，再选择“始终允许”，桌面天气组件才能获取新的位置。未开启时只能使用应用最近一小时内取得的真实位置，并标记为缓存。")
                        .setNegativeButton("取消", (value, which) -> fail(r.id, new Exception("User cancelled background location settings")))
                        .setPositiveButton("打开设置", (value, which) -> {
                            try { activity.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.getPackageName()))); finish(r.id, new JSONObject().put("opened", true).put("granted", false)); }
                            catch (Exception error) { fail(r.id, error); }
                        }).create(); show(r, dialog); break;
            }
            case "calendar.list":
                if ("reminders".equals(r.payload.optString("kind"))) background(r, this::reminderCalendars);
                else if (permission(r, Manifest.permission.READ_CALENDAR)) background(r, this::eventCalendars);
                break;
            case "calendar.save": case "calendar.remove":
                if ("reminders".equals(r.payload.optString("kind"))) background(r, () -> changeReminderCalendar(r));
                else if (permission(r, Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR)) background(r, () -> changeEventCalendar(r));
                break;
            case "calendar.picker": calendarPicker(r); break;
            case "event.list": if (permission(r, Manifest.permission.READ_CALENDAR)) background(r, () -> events(r.payload)); break;
            case "event.save": case "event.remove":
                if (permission(r, Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR)) background(r, () -> changeEvent(r)); break;
            case "event.edit": eventEditor(r); break;
            case "reminder.list": background(r, () -> reminders(r.payload)); break;
            case "reminder.save": case "reminder.remove": background(r, () -> changeReminder(r)); break;
            case "contacts.containers": case "contacts.groups": case "contacts.list":
                if (permission(r, Manifest.permission.READ_CONTACTS)) background(r, () -> r.action.equals("contacts.containers") ? containers() : r.action.equals("contacts.groups") ? groups(r.payload) : contacts(r.payload)); break;
            case "contacts.persist": if (permission(r, Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS)) background(r, () -> persistContacts(r.payload)); break;
            case "photos.pick": {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE);
                launch(r, intent); break;
            }
            case "photos.camera": {
                r.uri = sharedFile(new byte[0], "capture.jpg");
                Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, r.uri)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                intent.setClipData(ClipData.newRawUri("Camera output", r.uri)); launch(r, intent); break;
            }
            case "photos.latest": case "photos.remove": {
                String p = Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_IMAGES : Manifest.permission.READ_EXTERNAL_STORAGE;
                if (permission(r, p) && (Build.VERSION.SDK_INT >= 29 || !r.action.equals("photos.remove") || permission(r, Manifest.permission.WRITE_EXTERNAL_STORAGE))) {
                    if (r.action.equals("photos.latest")) background(r, () -> latestPhotos(r.payload));
                    else background(r, () -> { List<Uri> values = latestPhotoUris(r.payload); main.post(() -> removePhotos(r, values)); return Deferred.INSTANCE; });
                }
                break;
            }
            case "photos.save":
                if (Build.VERSION.SDK_INT < 29 && !permission(r, Manifest.permission.WRITE_EXTERNAL_STORAGE)) return;
                background(r, () -> savePhoto(r.payload)); break;
            case "documents.open": {
                Intent intent = new Intent(r.payload.optBoolean("folder") ? Intent.ACTION_OPEN_DOCUMENT_TREE : Intent.ACTION_OPEN_DOCUMENT);
                if (!r.payload.optBoolean("folder")) {
                    intent.setType("*/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE, r.payload.optBoolean("multiple"));
                    JSONArray types = r.payload.optJSONArray("types"); ArrayList<String> mime = new ArrayList<>();
                    if (types != null) for (int i = 0; i < types.length(); i++) mime.add(mimeType(types.optString(i)));
                    if (!mime.isEmpty()) intent.putExtra(Intent.EXTRA_MIME_TYPES, mime.toArray(new String[0]));
                }
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION); launch(r, intent); break;
            }
            case "documents.export": {
                r.bytes = Base64.decode(r.payload.getString("base64"), Base64.DEFAULT); checkBytes(r.bytes);
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType(r.payload.optString("mimeType", "application/octet-stream"))
                        .addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE, safeName(r.payload.optString("name", "Document")));
                launch(r, intent); break;
            }
            case "dictation.start": {
                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE, r.payload.optString("locale", Locale.getDefault().toLanguageTag())).putExtra(RecognizerIntent.EXTRA_PROMPT, "听写 / Dictation");
                launch(r, intent); break;
            }
            case "date.pick": datePicker(r); break;
            case "compose.mail": case "compose.message": compose(r); break;
            case "sharing.present": shareItems(r); break;
            case "document.preview": previewDocument(r); break;
            case "clipboard.writeImage": {
                background(r, () -> {
                    byte[] bytes = Base64.decode(r.payload.getString("base64"), Base64.DEFAULT); checkBytes(bytes);
                    BitmapFactory.Options info = new BitmapFactory.Options(); info.inJustDecodeBounds = true; BitmapFactory.decodeByteArray(bytes, 0, bytes.length, info);
                    if (info.outWidth <= 0) throw new Exception("Clipboard content is not a valid image");
                    String extension = info.outMimeType != null && info.outMimeType.equals("image/jpeg") ? "jpg" : info.outMimeType != null && info.outMimeType.equals("image/gif") ? "gif" : info.outMimeType != null && info.outMimeType.equals("image/webp") ? "webp" : "png";
                    Uri uri = sharedFile(bytes, "clipboard-image." + extension);
                    main.post(() -> {
                        if (!active.contains(r.id)) { deleteShared(uri); return; }
                        try {
                            android.content.ClipboardManager clipboard = (android.content.ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
                            clipboard.setPrimaryClip(ClipData.newUri(resolver, "Scriptable image", uri));
                            File[] files = new File(context.getFilesDir(), "shared").listFiles();
                            if (files != null) for (File file : files) if (file.isFile() && file.getName().contains("-clipboard-image.") && !file.getName().equals(uri.getLastPathSegment())) file.delete();
                            finish(r.id, true);
                        } catch (Exception error) { deleteShared(uri); fail(r.id, error); }
                    }); return Deferred.INSTANCE;
                }); break;
            }
            case "device.setBrightness": {
                double value = r.payload.getDouble("brightness"); if (!Double.isFinite(value) || value < 0 || value > 1) throw new Exception("Brightness must be between 0 and 1");
                WindowManager.LayoutParams attributes = activity.getWindow().getAttributes(); attributes.screenBrightness = (float) value; activity.getWindow().setAttributes(attributes);
                finish(r.id, true); break;
            }
            default: throw new Exception("Unknown Android service: " + r.action);
        }
    }
    private enum Deferred { INSTANCE }
    public boolean onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        PendingAction r = requests.get(requestCode); if (r == null || permissionRequest != requestCode) return false;
        requests.remove(requestCode); permissionRequest = -1;
        if (!active.contains(r.id)) return true;
        boolean fineOrCoarse = r.action.startsWith("location.") && (granted(Manifest.permission.ACCESS_COARSE_LOCATION) || granted(Manifest.permission.ACCESS_FINE_LOCATION));
        boolean allowed = grantResults.length > 0; for (int grant : grantResults) if (grant != PackageManager.PERMISSION_GRANTED) allowed = false;
        if (!allowed && !fineOrCoarse) { fail(r.id, new Exception("Android permission was denied for " + r.action)); return true; }
        try { dispatch(r); } catch (Exception error) { fail(r.id, error); } return true;
    }
    private void launch(PendingAction r, Intent intent) throws Exception {
        int code = nextRequest++; requests.put(code, r);
        try { activity.startActivityForResult(intent, code); } catch (Exception error) { requests.remove(code); throw new Exception("No compatible Android app is installed for " + r.action, error); }
    }
    public boolean onActivityResult(int requestCode, int resultCode, Intent data) {
        PendingAction r = requests.remove(requestCode); if (r == null) return false;
        if (!active.contains(r.id)) return true;
        if (r.action.startsWith("compose.")) { try { finish(r.id, new JSONObject().put("status", "externalComposerClosed").put("sent", JSONObject.NULL)); } catch (Exception error) { fail(r.id, error); } return true; }
        if (resultCode != Activity.RESULT_OK) { if (r.action.equals("photos.camera")) deleteShared(r.uri); fail(r.id, new Exception("User cancelled " + r.action)); return true; }
        switch (r.action) {
            case "dictation.start": {
                ArrayList<String> values = data == null ? null : data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                if (values == null || values.isEmpty()) fail(r.id, new Exception("The speech recognizer returned no words")); else finish(r.id, values.get(0)); break;
            }
            case "photos.pick": case "photos.camera": {
                Uri uri = r.action.equals("photos.camera") ? r.uri : data == null ? null : data.getData();
                if (uri == null) fail(r.id, new Exception("No image was returned")); else background(r, () -> { Object image = readImage(uri); if (r.action.equals("photos.camera")) deleteShared(uri); return image; }); break;
            }
            case "photos.remove": if (r.uris != null) removeLegacyPhotos(r); else finish(r.id, true); break;
            case "documents.export": {
                Uri uri = data == null ? null : data.getData();
                if (uri == null) fail(r.id, new Exception("No destination was returned"));
                else background(r, () -> { try (OutputStream output = resolver.openOutputStream(uri, "wt")) { if (output == null) throw new Exception("Cannot write the chosen document"); output.write(r.bytes); } return new JSONArray().put(uri.toString()); }); break;
            }
            case "documents.open": {
                List<Uri> values = new ArrayList<>();
                if (data != null && data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) values.add(data.getClipData().getItemAt(i).getUri());
                else if (data != null && data.getData() != null) values.add(data.getData());
                if (values.isEmpty()) fail(r.id, new Exception("No document was returned")); else background(r, () -> importDocuments(r.payload, values)); break;
            }
            default: fail(r.id, new Exception("Unknown activity result: " + r.action));
        }
        return true;
    }
    public void cancel(Set<String> ids) {
        for (String id : ids) {
            active.remove(id); Future<?> future = jobs.remove(id); if (future != null) future.cancel(true);
            javax.net.ssl.HttpsURLConnection geocode = geocodeConnections.remove(id); if (geocode != null) geocode.disconnect();
            AlertDialog dialog = dialogs.remove(id); if (dialog != null) dialog.dismiss();
            LocationListener listener = locations.remove(id); if (listener != null) try { ((LocationManager) context.getSystemService(Context.LOCATION_SERVICE)).removeUpdates(listener); } catch (Exception ignored) {}
        }
        for (Integer code : new ArrayList<>(requests.keySet())) {
            PendingAction value = requests.get(code);
            if (value != null && ids.contains(value.id)) {
                if (code == permissionRequest) continue; // Keep a cancelled tombstone until Android closes its permission dialog.
                requests.remove(code);
                if (value.uri != null && value.action.equals("photos.camera")) deleteShared(value.uri);
                try { activity.finishActivity(code); } catch (Exception ignored) {}
            }
        }
    }
    public void close() {
        cancel(new HashSet<>(active)); closed = true; executor.shutdownNow();
        if (sensorManager != null && sensorListener != null) sensorManager.unregisterListener(sensorListener);
        if (facingSource.get() == this) { facingAt = 0; facingSource.clear(); }
    }
    public static Object handleSync(Context context, String action, JSONObject payload) throws Exception {
        switch (action) {
            case "clipboard.readImage": {
                if (!(context instanceof Activity)) throw new Exception("Clipboard images can be read while the app is open");
                android.content.ClipboardManager clipboard = (android.content.ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
                ClipData clip = clipboard.getPrimaryClip(); if (clip == null || clip.getItemCount() == 0 || clip.getItemAt(0).getUri() == null) return JSONObject.NULL;
                Uri uri = clip.getItemAt(0).getUri(); byte[] bytes = read(context.getContentResolver().openInputStream(uri), MAX_BYTES);
                BitmapFactory.Options info = new BitmapFactory.Options(); info.inJustDecodeBounds = true; BitmapFactory.decodeByteArray(bytes, 0, bytes.length, info); if (info.outWidth <= 0) return JSONObject.NULL;
                return new JSONObject().put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP)).put("mimeType", info.outMimeType == null ? "image/png" : info.outMimeType).put("width", info.outWidth).put("height", info.outHeight);
            }
            case "device.brightness": {
                if (context instanceof Activity) { float value = ((Activity) context).getWindow().getAttributes().screenBrightness; if (value >= 0) return (double) value; }
                return Settings.System.getInt(context.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, 128) / 255.0;
            }
            case "device.volume": { AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE); return audio.getStreamVolume(AudioManager.STREAM_MUSIC) / (double) Math.max(1, audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)); }
            case "device.identifier": return Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
            case "device.preferredLanguages": {
                android.os.LocaleList locales = context.getResources().getConfiguration().getLocales(); JSONArray result = new JSONArray();
                for (int i = 0; i < locales.size(); i++) result.put(locales.get(i).toLanguageTag()); return result;
            }
            case "device.battery": {
                Intent battery = context.registerReceiver(null, new android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED));
                if (battery == null) return new JSONObject().put("level", -1).put("isCharging", false).put("isDischarging", false).put("isFullyCharged", false);
                int status = battery.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, android.os.BatteryManager.BATTERY_STATUS_UNKNOWN);
                int level = battery.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1), scale = battery.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1), plugged = battery.getIntExtra(android.os.BatteryManager.EXTRA_PLUGGED, -1);
                double fraction = level >= 0 && scale > 0 ? Math.min(1, level / (double) scale) : -1;
                return new JSONObject().put("level", fraction).put("isCharging", status == android.os.BatteryManager.BATTERY_STATUS_CHARGING)
                        .put("isDischarging", plugged == 0).put("isFullyCharged", status == android.os.BatteryManager.BATTERY_STATUS_FULL || fraction == 1);
            }
            case "device.screen": {
                android.hardware.display.DisplayManager manager = (android.hardware.display.DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE);
                android.view.Display display = manager == null ? null : manager.getDisplay(android.view.Display.DEFAULT_DISPLAY);
                android.util.DisplayMetrics metrics = new android.util.DisplayMetrics();
                if (display == null) metrics.setTo(context.getResources().getDisplayMetrics()); else display.getRealMetrics(metrics);
                int rotation = display == null ? 0 : display.getRotation();
                boolean quarter = rotation == android.view.Surface.ROTATION_90 || rotation == android.view.Surface.ROTATION_270;
                return new JSONObject().put("widthPixels", quarter ? metrics.heightPixels : metrics.widthPixels).put("heightPixels", quarter ? metrics.widthPixels : metrics.heightPixels)
                        .put("widthPoints", metrics.widthPixels / (double) metrics.density).put("heightPoints", metrics.heightPixels / (double) metrics.density).put("scale", metrics.density);
            }
            case "device.orientation": {
                android.hardware.display.DisplayManager manager = (android.hardware.display.DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE);
                android.view.Display display = manager == null ? null : manager.getDisplay(android.view.Display.DEFAULT_DISPLAY); int rotation = display == null ? 0 : display.getRotation();
                boolean portrait = context.getResources().getConfiguration().orientation == android.content.res.Configuration.ORIENTATION_PORTRAIT;
                boolean reverse = rotation == android.view.Surface.ROTATION_180 || rotation == android.view.Surface.ROTATION_270;
                boolean sampled = facingSource.get() != null && facingAt > 0 && android.os.SystemClock.elapsedRealtime() - facingAt < 3000;
                boolean horizontal = sampled && Math.abs(facingX) < 4 && Math.abs(facingY) < 4;
                return new JSONObject().put("rotation", rotation * 90).put("isInPortrait", portrait && !reverse).put("isInPortraitUpsideDown", portrait && reverse)
                        .put("isInLandscapeLeft", !portrait && !reverse).put("isInLandscapeRight", !portrait && reverse).put("isFaceUp", horizontal && facingZ > 7.5f).put("isFaceDown", horizontal && facingZ < -7.5f).put("facingAvailable", sampled);
            }
            case "device.setBrightness": {
                if (!(context instanceof Activity)) throw new Exception("Screen brightness can be changed while the app is open");
                double value = payload.getDouble("brightness"); if (!Double.isFinite(value) || value < 0 || value > 1) throw new Exception("Brightness must be between 0 and 1");
                Activity activity = (Activity) context;
                java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
                java.util.concurrent.atomic.AtomicBoolean waiting = new java.util.concurrent.atomic.AtomicBoolean(true);
                java.util.concurrent.atomic.AtomicReference<Exception> failure = new java.util.concurrent.atomic.AtomicReference<>();
                Runnable update = () -> {
                    if (!waiting.compareAndSet(true, false)) return;
                    try { WindowManager.LayoutParams parameters = activity.getWindow().getAttributes(); parameters.screenBrightness = (float) value; activity.getWindow().setAttributes(parameters); }
                    catch (Exception error) { failure.set(error); } finally { done.countDown(); }
                };
                if (Looper.myLooper() == Looper.getMainLooper()) update.run(); else new Handler(Looper.getMainLooper()).post(update);
                if (!done.await(2, java.util.concurrent.TimeUnit.SECONDS)) { waiting.set(false); throw new Exception("The app did not respond to the brightness change"); }
                if (failure.get() != null) throw failure.get(); return true;
            }
            default: throw new Exception("Unknown synchronous system action: " + action);
        }
    }
    private void currentLocation(PendingAction r) throws Exception {
        LocationManager manager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (activity == null && Build.VERSION.SDK_INT >= 29 && !granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
            JSONObject cached = cachedLocation(manager);
            if (cached != null) { finish(r.id, cached); return; }
            throw new Exception("The widget has no recent position. Open the app, run Location.current(), or call await Location.requestBackgroundAccess() and enable Always allow in Android location settings.");
        }
        List<String> providers = new ArrayList<>();
        if (granted(Manifest.permission.ACCESS_FINE_LOCATION) && manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) providers.add(LocationManager.GPS_PROVIDER);
        if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) providers.add(LocationManager.NETWORK_PROVIDER);
        if (providers.isEmpty()) throw new Exception("Location is disabled. Enable Android location services and retry.");
        double target = Math.max(10, r.payload.optDouble("accuracy", 10));
        Location[] best = {null};
        LocationListener listener = new LocationListener() {
            @Override public void onLocationChanged(Location value) {
                if (!active.contains(r.id)) return;
                if (best[0] == null || value.getAccuracy() < best[0].getAccuracy()) best[0] = value;
                if (value.getAccuracy() <= target || !granted(Manifest.permission.ACCESS_FINE_LOCATION)) complete(value);
            }
            private void complete(Location value) {
                manager.removeUpdates(this); locations.remove(r.id);
                try { JSONObject fix = locationJSON(value).put("isCached", false); rememberLocation(fix); finish(r.id, fix); } catch (Exception error) { fail(r.id, error); }
            }
            @Override public void onProviderEnabled(String provider) {}
            @Override public void onProviderDisabled(String provider) {}
            @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
        };
        locations.put(r.id, listener);
        for (String provider : providers) manager.requestLocationUpdates(provider, 0, 0, listener, Looper.getMainLooper());
        main.postDelayed(() -> {
            if (!active.contains(r.id) || locations.remove(r.id) == null) return;
            manager.removeUpdates(listener);
            Location found = best[0];
            for (String provider : providers) { Location value = manager.getLastKnownLocation(provider); if (value != null && System.currentTimeMillis() - value.getTime() < 120000 && (found == null || value.getAccuracy() < found.getAccuracy())) found = value; }
            if (found == null) fail(r.id, new Exception("Android could not obtain a position within 30 seconds"));
            else try { JSONObject fix = locationJSON(found).put("isCached", best[0] == null); rememberLocation(fix); finish(r.id, fix); } catch (Exception error) { fail(r.id, error); }
        }, 30000);
    }
    private JSONObject locationJSON(Location value) throws Exception {
        return new JSONObject().put("latitude", value.getLatitude()).put("longitude", value.getLongitude()).put("altitude", value.hasAltitude() ? value.getAltitude() : 0)
                .put("horizontalAccuracy", value.getAccuracy()).put("verticalAccuracy", Build.VERSION.SDK_INT >= 26 && value.hasVerticalAccuracy() ? value.getVerticalAccuracyMeters() : -1)
                .put("course", value.hasBearing() ? value.getBearing() : -1).put("speed", value.hasSpeed() ? value.getSpeed() : -1).put("timestamp", value.getTime());
    }
    private void rememberLocation(JSONObject value) { context.getSharedPreferences("location", Context.MODE_PRIVATE).edit().putString("lastFix", value.toString()).apply(); }
    private JSONObject cachedLocation(LocationManager manager) throws Exception {
        JSONObject best = null; String stored = context.getSharedPreferences("location", Context.MODE_PRIVATE).getString("lastFix", "");
        if (!stored.isEmpty()) try { best = new JSONObject(stored); } catch (Exception ignored) {}
        for (String provider : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER}) {
            try { Location value = manager.getLastKnownLocation(provider); if (value != null && (best == null || value.getTime() > best.optLong("timestamp"))) best = locationJSON(value); } catch (SecurityException ignored) {}
        }
        if (best == null) return null;
        long age = System.currentTimeMillis() - best.optLong("timestamp"); if (age < 0 || age >= 3600000) return null;
        return best.put("isCached", true).put("ageSeconds", age / 1000.0);
    }
    @SuppressWarnings("deprecation") private JSONArray reverseGeocode(String id, JSONObject p) throws Exception {
        double latitude = p.getDouble("latitude"), longitude = p.getDouble("longitude");
        if (!Double.isFinite(latitude) || Math.abs(latitude) > 90 || !Double.isFinite(longitude) || Math.abs(longitude) > 180) throw new Exception("Invalid geographic coordinates");
        if (!Geocoder.isPresent()) return providerGeocode(id, p);
        List<Address> values;
        try { values = new Geocoder(context, Locale.forLanguageTag(p.optString("locale", Locale.getDefault().toLanguageTag()))).getFromLocation(latitude, longitude, 5); }
        catch (java.io.IOException | IllegalStateException error) { return providerGeocode(id, p); }
        JSONArray result = new JSONArray(); if (values == null) return result;
        for (Address value : values) result.put(new JSONObject().put("name", nullable(value.getFeatureName())).put("postalAddress", new JSONObject()
                .put("street", nullable(value.getThoroughfare())).put("city", nullable(value.getLocality())).put("state", nullable(value.getAdminArea())).put("postalCode", nullable(value.getPostalCode())).put("country", nullable(value.getCountryName())).put("isoCountryCode", nullable(value.getCountryCode())))
                .put("locality", nullable(value.getLocality())).put("subLocality", nullable(value.getSubLocality())).put("administrativeArea", nullable(value.getAdminArea())).put("subAdministrativeArea", nullable(value.getSubAdminArea())).put("country", nullable(value.getCountryName())).put("isoCountryCode", nullable(value.getCountryCode())).put("postalCode", nullable(value.getPostalCode()))
                .put("thoroughfare", nullable(value.getThoroughfare())).put("subThoroughfare", nullable(value.getSubThoroughfare())).put("timeZone", JSONObject.NULL).put("provider", "Android Geocoder"));
        return result;
    }
    private static final Object GEOCODE_LOCK = new Object();
    private static long lastProviderRequest;
    /** Opt-in Nominatim-compatible HTTPS service. No public endpoint is silently selected. */
    private JSONArray providerGeocode(String id, JSONObject p) throws Exception {
        android.content.SharedPreferences preferences = context.getSharedPreferences("location", Context.MODE_PRIVATE);
        String endpoint = preferences.getString("geocodingProvider", "");
        if (endpoint.isEmpty()) throw new Exception("Android has no working geocoding service. Configure your HTTPS Nominatim-compatible provider with await Location.setGeocodingProvider(endpoint). This sends the requested coordinates to that provider; public services have their own usage and privacy policies.");
        String locale = p.optString("locale", Locale.getDefault().toLanguageTag());
        String cacheInput = endpoint + "\n" + locale + "\n" + String.format(Locale.US, "%.5f,%.5f", p.getDouble("latitude"), p.getDouble("longitude"));
        byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(cacheInput.getBytes(StandardCharsets.UTF_8));
        String key = "geocode-" + Base64.encodeToString(digest, Base64.NO_WRAP);
        synchronized (GEOCODE_LOCK) {
            String stored = preferences.getString(key, "");
            if (!stored.isEmpty()) {
                JSONObject value = new JSONObject(stored);
                if (System.currentTimeMillis() - value.optLong("savedAt") < 86400000L) return value.getJSONArray("result");
            }
            long delay = 1000 - (android.os.SystemClock.elapsedRealtime() - lastProviderRequest);
            if (delay > 0) Thread.sleep(delay);
            if (closed || !active.contains(id) || Thread.currentThread().isInterrupted()) throw new InterruptedException("Script stopped");
            lastProviderRequest = android.os.SystemClock.elapsedRealtime();
            Uri uri = Uri.parse(endpoint).buildUpon().appendQueryParameter("format", "jsonv2").appendQueryParameter("addressdetails", "1")
                    .appendQueryParameter("lat", String.valueOf(p.getDouble("latitude"))).appendQueryParameter("lon", String.valueOf(p.getDouble("longitude"))).appendQueryParameter("accept-language", locale).build();
            javax.net.ssl.HttpsURLConnection connection = (javax.net.ssl.HttpsURLConnection) new java.net.URL(uri.toString()).openConnection();
            geocodeConnections.put(id, connection);
            JSONObject response;
            try {
                connection.setConnectTimeout(15000); connection.setReadTimeout(15000); connection.setInstanceFollowRedirects(false);
                connection.setRequestProperty("User-Agent", "ScriptableAndroid/0.2 (dev.scriptable.android; user-configured geocoding)"); connection.setRequestProperty("Accept", "application/json"); connection.setRequestProperty("Accept-Language", locale);
                int status = connection.getResponseCode(); if (status != 200) throw new Exception("Configured geocoding provider returned HTTP " + status);
                response = new JSONObject(new String(read(connection.getInputStream(), 1024 * 1024), StandardCharsets.UTF_8));
            } finally { geocodeConnections.remove(id); connection.disconnect(); }
            if (response.has("error")) throw new Exception("Configured geocoding provider has no address for this position");
            JSONArray result = new JSONArray().put(mapProviderAddress(response));
            android.content.SharedPreferences.Editor editor = preferences.edit();
            Map<String, ?> all = preferences.getAll(); List<String> keys = new ArrayList<>(); for (String name : all.keySet()) if (name.startsWith("geocode-")) keys.add(name);
            while (keys.size() >= 64 && !keys.contains(key)) { String oldest = keys.remove(0); editor.remove(oldest); }
            editor.putString(key, new JSONObject().put("savedAt", System.currentTimeMillis()).put("result", result).toString()).apply();
            return result;
        }
    }
    static JSONObject mapProviderAddress(JSONObject response) throws Exception {
        JSONObject address = response.optJSONObject("address"); if (address == null) address = new JSONObject();
        String street = first(address, "road", "pedestrian", "footway", "path"), number = first(address, "house_number"), city = first(address, "city", "town", "village", "hamlet", "locality");
        String suburb = first(address, "suburb", "neighbourhood", "quarter", "city_district"), state = first(address, "state", "province", "region"), county = first(address, "county", "state_district", "district");
        String country = first(address, "country"), code = first(address, "country_code").toUpperCase(Locale.ROOT), postal = first(address, "postcode");
        JSONObject postalAddress = new JSONObject().put("street", nullable(street.isEmpty() ? null : number.isEmpty() ? street : number + " " + street)).put("city", nullable(empty(city))).put("state", nullable(empty(state))).put("postalCode", nullable(empty(postal))).put("country", nullable(empty(country))).put("isoCountryCode", nullable(empty(code)));
        return new JSONObject().put("name", nullable(empty(first(response, "name", "display_name")))).put("postalAddress", postalAddress)
                .put("locality", nullable(empty(city))).put("subLocality", nullable(empty(suburb))).put("administrativeArea", nullable(empty(state))).put("subAdministrativeArea", nullable(empty(county)))
                .put("country", nullable(empty(country))).put("isoCountryCode", nullable(empty(code))).put("postalCode", nullable(empty(postal))).put("thoroughfare", nullable(empty(street))).put("subThoroughfare", nullable(empty(number)))
                .put("timeZone", JSONObject.NULL).put("provider", "Configured Nominatim-compatible service").put("attribution", response.optString("licence", "Provider terms apply"));
    }
    private static String first(JSONObject value, String... names) { for (String name : names) { String text = value.optString(name, ""); if (!text.isEmpty() && !text.equals("null")) return text; } return ""; }
    private static Object empty(String value) { return value.isEmpty() ? null : value; }
    private static Object nullable(Object value) { return value == null ? JSONObject.NULL : value; }
    private static String string(Cursor cursor, String column) { int index = cursor.getColumnIndex(column); return index < 0 || cursor.isNull(index) ? "" : cursor.getString(index); }
    private static long number(Cursor cursor, String column) { int index = cursor.getColumnIndex(column); return index < 0 || cursor.isNull(index) ? 0 : cursor.getLong(index); }
    private static Set<String> selected(JSONArray array) { if (array == null) return null; Set<String> result = new HashSet<>(); for (int i = 0; i < array.length(); i++) result.add(array.optString(i)); return result; }
    private static String safeName(String value) { String result = value.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim(); if (result.equals(".") || result.equals("..")) result = "Document"; return result.isEmpty() ? "Document" : result.substring(0, Math.min(120, result.length())); }
    private static String mimeType(String value) {
        switch (value) { case "public.image": return "image/*"; case "public.png": return "image/png"; case "public.jpeg": return "image/jpeg"; case "public.text": case "public.plain-text": return "text/plain"; case "public.json": return "application/json"; case "com.adobe.pdf": return "application/pdf"; default: return value.contains("/") ? value : "*/*"; }
    }
    private static void checkBytes(byte[] bytes) throws Exception { if (bytes.length > MAX_BYTES) throw new Exception("This item exceeds the 3 MB system bridge limit"); }
    private static byte[] read(InputStream input, int maximum) throws Exception {
        if (input == null) throw new Exception("Cannot open the chosen content");
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = stream.read(buffer)) != -1) { if (Thread.currentThread().isInterrupted()) throw new InterruptedException("Script stopped"); if (output.size() + count > maximum) throw new Exception("This item exceeds the system bridge size limit"); output.write(buffer, 0, count); } return output.toByteArray();
        }
    }
    private JSONArray eventCalendars() throws Exception {
        JSONArray result = new JSONArray();
        String[] columns = { CalendarContract.Calendars._ID, CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, CalendarContract.Calendars.CALENDAR_COLOR,
                CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL, CalendarContract.Calendars.ALLOWED_AVAILABILITY, CalendarContract.Calendars.ACCOUNT_NAME, CalendarContract.Calendars.ACCOUNT_TYPE };
        try (Cursor cursor = resolver.query(CalendarContract.Calendars.CONTENT_URI, columns, null, null, CalendarContract.Calendars.CALENDAR_DISPLAY_NAME + " ASC")) {
            if (cursor == null) throw new Exception("The Android Calendar provider is unavailable");
            while (cursor.moveToNext()) {
                JSONArray availability = new JSONArray();
                for (String value : string(cursor, CalendarContract.Calendars.ALLOWED_AVAILABILITY).split(",")) {
                    if (value.equals("0")) availability.put("busy"); if (value.equals("1")) availability.put("free"); if (value.equals("2")) availability.put("tentative");
                }
                if (availability.length() == 0) { availability.put("busy"); availability.put("free"); availability.put("tentative"); }
                result.put(new JSONObject().put("identifier", string(cursor, CalendarContract.Calendars._ID)).put("title", string(cursor, CalendarContract.Calendars.CALENDAR_DISPLAY_NAME))
                        .put("color", String.format(Locale.US, "#%06X", number(cursor, CalendarContract.Calendars.CALENDAR_COLOR) & 0xffffff))
                        .put("kind", "events").put("allowsContentModifications", number(cursor, CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL) >= CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR)
                        .put("isSubscribed", number(cursor, CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL) < CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR).put("availabilities", availability));
            }
        }
        return result;
    }
    private JSONObject eventCalendar(String id) throws Exception {
        JSONArray values = eventCalendars(); for (int i = 0; i < values.length(); i++) if (values.getJSONObject(i).getString("identifier").equals(id)) return values.getJSONObject(i);
        throw new Exception("Calendar was not found: " + id);
    }
    private Object changeEventCalendar(PendingAction r) throws Exception {
        String id = r.payload.optString("identifier"); if (id.isEmpty()) throw new Exception("Android event calendars are created by the system account provider; use its Calendar app to add an account.");
        JSONObject existing = eventCalendar(id); if (!existing.getBoolean("allowsContentModifications")) throw new Exception("This calendar is read-only");
        Uri uri = ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI, Long.parseLong(id));
        if (r.action.equals("calendar.remove")) { if (resolver.delete(uri, null, null) == 0) throw new Exception("Calendar was not found"); return true; }
        ContentValues values = new ContentValues(); values.put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, r.payload.getString("title"));
        values.put(CalendarContract.Calendars.CALENDAR_COLOR, android.graphics.Color.parseColor(r.payload.optString("color", "#477EF7")));
        if (resolver.update(uri, values, null, null) == 0) throw new Exception("Calendar was not found"); return eventCalendar(id);
    }
    private JSONArray events(JSONObject p) throws Exception {
        long start = p.getLong("startDate"), end = p.getLong("endDate"); if (end < start) throw new Exception("End date precedes start date");
        if (end - start > 3660L * 86400000L) throw new Exception("Fetch at most ten years of events at a time");
        Set<String> calendars = selected(p.optJSONArray("calendars")); if (calendars != null && calendars.isEmpty()) return new JSONArray();
        Map<String, JSONObject> calendarValues = new HashMap<>(); JSONArray all = eventCalendars(); for (int i = 0; i < all.length(); i++) calendarValues.put(all.getJSONObject(i).getString("identifier"), all.getJSONObject(i));
        Uri.Builder uri = CalendarContract.Instances.CONTENT_URI.buildUpon(); ContentUris.appendId(uri, start); ContentUris.appendId(uri, end);
        String[] columns = { CalendarContract.Instances.EVENT_ID, CalendarContract.Instances.BEGIN, CalendarContract.Instances.END, CalendarContract.Instances.CALENDAR_ID };
        JSONArray result = new JSONArray(); Map<String, JSONObject> originals = new HashMap<>();
        try (Cursor cursor = resolver.query(uri.build(), columns, null, null, CalendarContract.Instances.BEGIN + " ASC")) {
            if (cursor == null) throw new Exception("Cannot read Android calendar events");
            while (cursor.moveToNext()) {
                if (result.length() >= 2000) throw new Exception("More than 2000 events matched; use a shorter date range");
                String calendar = string(cursor, CalendarContract.Instances.CALENDAR_ID); if (calendars != null && !calendars.contains(calendar)) continue;
                String id = string(cursor, CalendarContract.Instances.EVENT_ID); JSONObject original = originals.get(id);
                if (original == null) { original = event(id); originals.put(id, original); }
                JSONObject value = new JSONObject(original.toString()); value.put("startDate", number(cursor, CalendarContract.Instances.BEGIN)).put("endDate", number(cursor, CalendarContract.Instances.END));
                value.put("calendar", calendarValues.get(calendar)); result.put(value);
            }
        }
        return result;
    }
    private JSONObject event(String id) throws Exception {
        Uri uri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, Long.parseLong(id));
        String[] columns = { CalendarContract.Events._ID, CalendarContract.Events.CALENDAR_ID, CalendarContract.Events.TITLE, CalendarContract.Events.DESCRIPTION, CalendarContract.Events.EVENT_LOCATION,
                CalendarContract.Events.DTSTART, CalendarContract.Events.DTEND, CalendarContract.Events.DURATION, CalendarContract.Events.ALL_DAY, CalendarContract.Events.EVENT_TIMEZONE, CalendarContract.Events.AVAILABILITY, CalendarContract.Events.RRULE };
        JSONObject value;
        try (Cursor cursor = resolver.query(uri, columns, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) throw new Exception("Event was not found");
            long start = number(cursor, CalendarContract.Events.DTSTART), end = number(cursor, CalendarContract.Events.DTEND);
            if (end == 0) { String duration = string(cursor, CalendarContract.Events.DURATION); try { end = start + java.time.Duration.parse(duration).toMillis(); } catch (Exception ignored) { end = start + 3600000; } }
            int availability = (int) number(cursor, CalendarContract.Events.AVAILABILITY);
            JSONArray rules = new JSONArray(); String rule = string(cursor, CalendarContract.Events.RRULE); if (!rule.isEmpty()) rules.put(rule);
            value = new JSONObject().put("identifier", id).put("title", string(cursor, CalendarContract.Events.TITLE)).put("notes", string(cursor, CalendarContract.Events.DESCRIPTION))
                    .put("location", string(cursor, CalendarContract.Events.EVENT_LOCATION)).put("startDate", start).put("endDate", end)
                    .put("isAllDay", number(cursor, CalendarContract.Events.ALL_DAY) != 0).put("timeZone", string(cursor, CalendarContract.Events.EVENT_TIMEZONE))
                    .put("availability", availability == 1 ? "free" : availability == 2 ? "tentative" : "busy").put("recurrenceRules", rules)
                    .put("calendar", eventCalendar(string(cursor, CalendarContract.Events.CALENDAR_ID)));
        }
        JSONArray attendees = new JSONArray();
        try (Cursor cursor = resolver.query(CalendarContract.Attendees.CONTENT_URI, null, CalendarContract.Attendees.EVENT_ID + "=?", new String[]{id}, null)) {
            if (cursor != null) while (cursor.moveToNext()) {
                int status = (int) number(cursor, CalendarContract.Attendees.ATTENDEE_STATUS);
                int relation = (int) number(cursor, CalendarContract.Attendees.ATTENDEE_RELATIONSHIP);
                attendees.put(new JSONObject().put("name", string(cursor, CalendarContract.Attendees.ATTENDEE_NAME)).put("email", string(cursor, CalendarContract.Attendees.ATTENDEE_EMAIL))
                        .put("status", status == 1 ? "accepted" : status == 2 ? "declined" : status == 4 ? "tentative" : "pending").put("type", "person")
                        .put("role", number(cursor, CalendarContract.Attendees.ATTENDEE_TYPE) == 2 ? "optional" : "required").put("isCurrentUser", false).put("isOrganizer", relation == CalendarContract.Attendees.RELATIONSHIP_ORGANIZER));
            }
        }
        return value.put("attendees", attendees);
    }
    private Object changeEvent(PendingAction r) throws Exception {
        JSONObject p = r.payload; String id = p.optString("identifier");
        if (r.action.equals("event.remove")) {
            if (id.isEmpty()) throw new Exception("The event has not been saved");
            JSONObject existing = event(id); if (!existing.getJSONObject("calendar").getBoolean("allowsContentModifications")) throw new Exception("The event calendar is read-only");
            if (resolver.delete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, Long.parseLong(id)), null, null) == 0) throw new Exception("Event was not found"); return true;
        }
        JSONObject calendar = p.optJSONObject("calendar");
        if (calendar == null) {
            JSONArray calendars = eventCalendars(); for (int i = 0; i < calendars.length(); i++) if (calendars.getJSONObject(i).getBoolean("allowsContentModifications")) { calendar = calendars.getJSONObject(i); break; }
        }
        if (calendar == null) throw new Exception("No writable Android calendar is configured. Add a calendar account in the system Calendar app.");
        calendar = eventCalendar(calendar.getString("identifier")); if (!calendar.getBoolean("allowsContentModifications")) throw new Exception("This calendar is read-only");
        long start = p.getLong("startDate"), end = p.getLong("endDate"); if (end < start) throw new Exception("End date precedes start date");
        String title = p.optString("title"); if (title.length() > 1000 || p.optString("notes").length() > 50000) throw new Exception("Event text is too long");
        boolean allDay = p.optBoolean("isAllDay"); String zone = p.optString("timeZone", TimeZone.getDefault().getID());
        if (allDay) { start = allDayUTC(start, zone); end = allDayUTC(end, zone); if (end <= start) end = start + 86400000; zone = "UTC"; }
        ContentValues values = new ContentValues(); values.put(CalendarContract.Events.CALENDAR_ID, Long.parseLong(calendar.getString("identifier")));
        values.put(CalendarContract.Events.TITLE, title); values.put(CalendarContract.Events.DESCRIPTION, p.optString("notes")); values.put(CalendarContract.Events.EVENT_LOCATION, p.optString("location"));
        values.put(CalendarContract.Events.DTSTART, start); values.put(CalendarContract.Events.EVENT_TIMEZONE, zone); values.put(CalendarContract.Events.ALL_DAY, allDay ? 1 : 0);
        String availability = p.optString("availability", "busy");
        if (!Arrays.asList("busy", "free", "tentative").contains(availability)) throw new Exception("Android supports busy, free and tentative availability");
        values.put(CalendarContract.Events.AVAILABILITY, availability.equals("free") ? 1 : availability.equals("tentative") ? 2 : 0);
        JSONArray rules = p.optJSONArray("recurrenceRules");
        if (rules != null && rules.length() > 1) throw new Exception("The Android Calendar provider accepts one recurrence rule per event. Use separate events for additional rules.");
        if (rules != null && rules.length() > 0) {
            values.put(CalendarContract.Events.RRULE, rules.getString(0)); values.putNull(CalendarContract.Events.DTEND);
            values.put(CalendarContract.Events.DURATION, allDay ? "P" + Math.max(1, (end - start) / 86400000) + "D" : "P" + Math.max(1, (end - start) / 1000) + "S");
        } else { values.put(CalendarContract.Events.DTEND, end); values.putNull(CalendarContract.Events.DURATION); values.putNull(CalendarContract.Events.RRULE); }
        if (id.isEmpty()) { Uri uri = resolver.insert(CalendarContract.Events.CONTENT_URI, values); if (uri == null) throw new Exception("Android could not create the event"); id = uri.getLastPathSegment(); }
        else if (resolver.update(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, Long.parseLong(id)), values, null, null) == 0) throw new Exception("Event was not found");
        return event(id);
    }
    private static long allDayUTC(long millis, String zone) { Calendar source = Calendar.getInstance(TimeZone.getTimeZone(zone)); source.setTimeInMillis(millis); Calendar utc = Calendar.getInstance(TimeZone.getTimeZone("UTC")); utc.clear(); utc.set(source.get(Calendar.YEAR), source.get(Calendar.MONTH), source.get(Calendar.DAY_OF_MONTH)); return utc.getTimeInMillis(); }
    private void calendarPicker(PendingAction r) throws Exception {
        JSONArray values = r.payload.getJSONArray("values"); String[] names = new String[values.length()]; for (int i = 0; i < values.length(); i++) names[i] = values.getJSONObject(i).getString("title") + (values.getJSONObject(i).optString("kind").equals("reminders") ? " · 提醒事项" : " · 日历");
        if (values.length() == 0) { finish(r.id, new JSONArray()); return; }
        AlertDialog.Builder builder = new AlertDialog.Builder(activity).setTitle("选择日历 / Calendars").setNegativeButton("取消", (dialog, which) -> fail(r.id, new Exception("User cancelled calendar picker")));
        if (r.payload.optBoolean("allowMultiple")) { boolean[] checked = new boolean[names.length]; builder.setMultiChoiceItems(names, checked, (dialog, which, on) -> checked[which] = on).setPositiveButton("完成", (dialog, which) -> { JSONArray result = new JSONArray(); for (int i = 0; i < checked.length; i++) if (checked[i]) result.put(values.opt(i)); finish(r.id, result); }); }
        else builder.setItems(names, (dialog, which) -> finish(r.id, new JSONArray().put(values.opt(which))));
        show(r, builder.create());
    }
    private void show(PendingAction r, AlertDialog dialog) { dialogs.put(r.id, dialog); dialog.setOnCancelListener(value -> fail(r.id, new Exception("User cancelled " + r.action))); dialog.setOnDismissListener(value -> dialogs.remove(r.id, dialog)); dialog.show(); }
    private void eventEditor(PendingAction r) throws Exception {
        JSONObject value = new JSONObject(r.payload.toString());
        LinearLayout panel = new LinearLayout(activity); panel.setOrientation(LinearLayout.VERTICAL); int padding = (int) (20 * activity.getResources().getDisplayMetrics().density); panel.setPadding(padding, padding / 2, padding, padding / 2);
        EditText title = new EditText(activity); title.setHint("标题 / Title"); title.setText(value.optString("title")); panel.addView(title);
        EditText location = new EditText(activity); location.setHint("地点 / Location"); location.setText(value.optString("location")); panel.addView(location);
        EditText notes = new EditText(activity); notes.setHint("备注 / Notes"); notes.setText(value.optString("notes")); panel.addView(notes);
        android.widget.CheckBox allDay = new android.widget.CheckBox(activity); allDay.setText("全天 / All day"); allDay.setChecked(value.optBoolean("isAllDay")); panel.addView(allDay);
        for (String key : new String[]{"startDate", "endDate"}) {
            android.widget.Button button = new android.widget.Button(activity); button.setText((key.equals("startDate") ? "开始 " : "结束 ") + java.text.DateFormat.getDateTimeInstance().format(new java.util.Date(value.optLong(key, System.currentTimeMillis()))));
            button.setOnClickListener(view -> {
                Calendar initial = Calendar.getInstance(); initial.setTimeInMillis(value.optLong(key, System.currentTimeMillis()));
                new DatePickerDialog(activity, (picker, year, month, day) -> {
                    initial.set(year, month, day);
                    new TimePickerDialog(activity, (time, hour, minute) -> { initial.set(Calendar.HOUR_OF_DAY, hour); initial.set(Calendar.MINUTE, minute); initial.set(Calendar.SECOND, 0); try { value.put(key, initial.getTimeInMillis()); button.setText((key.equals("startDate") ? "开始 " : "结束 ") + java.text.DateFormat.getDateTimeInstance().format(initial.getTime())); } catch (Exception error) { fail(r.id, error); } }, initial.get(Calendar.HOUR_OF_DAY), initial.get(Calendar.MINUTE), true).show();
                }, initial.get(Calendar.YEAR), initial.get(Calendar.MONTH), initial.get(Calendar.DAY_OF_MONTH)).show();
            }); panel.addView(button);
        }
        AlertDialog dialog = new AlertDialog.Builder(activity).setTitle(value.optString("identifier").isEmpty() ? "新建事件 / New event" : "编辑事件 / Edit event").setView(panel).setNegativeButton("取消", (d, which) -> fail(r.id, new Exception("User cancelled event editor"))).setPositiveButton("保存", null).create();
        show(r, dialog);
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            try {
                value.put("title", title.getText().toString()).put("location", location.getText().toString()).put("notes", notes.getText().toString()).put("isAllDay", allDay.isChecked());
                if (value.getLong("endDate") < value.getLong("startDate")) { notes.setError("结束时间不能早于开始时间"); return; }
                dialog.dismiss(); dispatch(new PendingAction(r.id, "event.save", value));
            } catch (Exception error) { fail(r.id, error); }
        });
    }
    private static final Object REMINDER_LOCK = new Object();
    private JSONObject reminderStore() throws Exception {
        String text = context.getSharedPreferences("android-reminders", Context.MODE_PRIVATE).getString("json", "");
        if (!text.isEmpty()) return new JSONObject(text);
        JSONObject list = new JSONObject().put("identifier", "reminders-default").put("title", "提醒事项 / Reminders").put("color", "#477EF7").put("kind", "reminders").put("allowsContentModifications", true).put("isSubscribed", false);
        return new JSONObject().put("lists", new JSONArray().put(list)).put("items", new JSONArray());
    }
    private void saveReminderStore(JSONObject value) throws Exception {
        String text = value.toString(); if (text.getBytes(StandardCharsets.UTF_8).length > 2 * 1024 * 1024) throw new Exception("Reminder storage exceeds 2 MB");
        if (!context.getSharedPreferences("android-reminders", Context.MODE_PRIVATE).edit().putString("json", text).commit()) throw new Exception("Reminder storage could not be saved");
    }
    private JSONArray reminderCalendars() throws Exception { synchronized (REMINDER_LOCK) { return reminderStore().getJSONArray("lists"); } }
    private Object changeReminderCalendar(PendingAction r) throws Exception {
        synchronized (REMINDER_LOCK) {
            JSONObject store = reminderStore(); JSONArray lists = store.getJSONArray("lists"), next = new JSONArray();
            String id = r.payload.optString("identifier"); boolean exists = false;
            for (int i = 0; i < lists.length(); i++) { JSONObject item = lists.getJSONObject(i); if (id.equals(item.getString("identifier"))) exists = true; else next.put(item); }
            if (r.action.equals("calendar.remove")) {
                if (!exists) throw new Exception("Reminder list was not found");
                if (next.length() == 0) throw new Exception("Keep at least one reminder list");
                JSONArray tasks = new JSONArray(); JSONArray items = store.getJSONArray("items");
                for (int i = 0; i < items.length(); i++) if (!items.getJSONObject(i).getJSONObject("calendar").getString("identifier").equals(id)) tasks.put(items.get(i));
                store.put("lists", next).put("items", tasks); saveReminderStore(store); return true;
            }
            if (!id.isEmpty() && !exists) throw new Exception("Reminder list was not found");
            String title = r.payload.optString("title").trim(); if (title.isEmpty() || title.length() > 200) throw new Exception("Reminder list title must contain 1–200 characters");
            if (id.isEmpty()) id = "reminders-" + UUID.randomUUID();
            JSONObject list = new JSONObject().put("identifier", id).put("title", title).put("color", r.payload.optString("color", "#477EF7")).put("kind", "reminders").put("allowsContentModifications", true).put("isSubscribed", false);
            next.put(list); store.put("lists", next);
            JSONArray tasks = store.getJSONArray("items"); for (int i = 0; i < tasks.length(); i++) if (tasks.getJSONObject(i).getJSONObject("calendar").getString("identifier").equals(id)) tasks.getJSONObject(i).put("calendar", list);
            saveReminderStore(store); return list;
        }
    }
    private JSONArray reminders(JSONObject p) throws Exception {
        synchronized (REMINDER_LOCK) {
            JSONObject store = reminderStore(); JSONArray items = store.getJSONArray("items"), result = new JSONArray();
            Set<String> calendars = selected(p.optJSONArray("calendars"));
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i);
                if (calendars != null && !calendars.contains(item.getJSONObject("calendar").getString("identifier"))) continue;
                if (p.has("completion") && !p.isNull("completion") && p.getBoolean("completion") != item.optBoolean("isCompleted")) continue;
                if (p.optBoolean("scheduled") && item.isNull("dueDate")) continue;
                if (p.has("startDate")) {
                    String field = p.optString("dateField", "dueDate"); if (item.isNull(field)) continue;
                    long value = item.optLong(field); if (value < p.getLong("startDate") || value >= p.getLong("endDate")) continue;
                }
                result.put(item);
            }
            return result;
        }
    }
    private Object changeReminder(PendingAction r) throws Exception {
        synchronized (REMINDER_LOCK) {
            JSONObject store = reminderStore(); JSONArray items = store.getJSONArray("items"), next = new JSONArray();
            String id = r.payload.optString("identifier"); JSONObject previous = null;
            for (int i = 0; i < items.length(); i++) { JSONObject value = items.getJSONObject(i); if (value.getString("identifier").equals(id)) previous = value; else next.put(value); }
            if (r.action.equals("reminder.remove")) { if (previous == null) throw new Exception("Reminder was not found"); store.put("items", next); saveReminderStore(store); return true; }
            if (!id.isEmpty() && previous == null) throw new Exception("Reminder was not found");
            JSONObject calendar = null; String calendarId = r.payload.getJSONObject("calendar").getString("identifier"); JSONArray lists = store.getJSONArray("lists");
            for (int i = 0; i < lists.length(); i++) if (lists.getJSONObject(i).getString("identifier").equals(calendarId)) calendar = lists.getJSONObject(i);
            if (calendar == null) throw new Exception("Reminder list was not found");
            if (r.payload.optString("title").length() > 1000 || r.payload.optString("notes").length() > 50000) throw new Exception("Reminder text is too long");
            int priority = r.payload.optInt("priority"); if (priority < 0 || priority > 9) throw new Exception("Priority must be from 0 to 9");
            JSONObject value = new JSONObject(r.payload.toString()); value.put("identifier", id.isEmpty() ? UUID.randomUUID().toString() : id).put("calendar", calendar);
            long now = System.currentTimeMillis(); value.put("creationDate", previous == null ? now : previous.optLong("creationDate", now));
            boolean completed = value.optBoolean("isCompleted");
            value.put("completionDate", completed ? previous != null && previous.optBoolean("isCompleted") ? previous.optLong("completionDate", now) : now : JSONObject.NULL);
            value.put("_recurrenceStart", previous == null ? value.optLong("dueDate", now) : previous.optLong("_recurrenceStart", value.optLong("dueDate", now)));
            value.put("_occurrence", previous == null ? 1 : previous.optInt("_occurrence", 1));
            next.put(value);
            JSONObject nextReminder = null;
            if (completed && (previous == null || !previous.optBoolean("isCompleted")) && !value.isNull("dueDate")) {
                long upcoming = nextRecurrence(value);
                if (upcoming >= 0) {
                    nextReminder = new JSONObject(value.toString()).put("identifier", UUID.randomUUID().toString()).put("isCompleted", false).put("completionDate", JSONObject.NULL).put("dueDate", upcoming).put("_occurrence", value.optInt("_occurrence", 1) + 1);
                    next.put(nextReminder);
                }
            }
            store.put("items", next); saveReminderStore(store);
            JSONObject result = new JSONObject(value.toString()); if (nextReminder != null) result.put("_nextReminder", nextReminder); return result;
        }
    }
    /** Selects the next RFC5545 date for app-owned reminder lists, including negative selectors and BYSETPOS. */
    private static long nextRecurrence(JSONObject reminder) throws Exception {
        JSONArray rules = reminder.optJSONArray("recurrenceRules"); if (rules == null) return -1;
        long after = reminder.getLong("dueDate"), origin = reminder.optLong("_recurrenceStart", after), best = -1;
        for (int i = 0; i < rules.length(); i++) {
            Map<String, String> rule = new HashMap<>(); for (String part : rules.getString(i).split(";")) { String[] kv = part.split("=", 2); if (kv.length == 2) rule.put(kv[0], kv[1]); }
            int occurrence = reminder.optInt("_occurrence", 1), count = Integer.parseInt(rule.getOrDefault("COUNT", "2147483647")); if (occurrence >= count) continue;
            long until = Long.MAX_VALUE;
            if (rule.containsKey("UNTIL")) { SimpleDateFormat formatter = new SimpleDateFormat("yyyyMMdd'T'HHmmss'Z'", Locale.US); formatter.setTimeZone(TimeZone.getTimeZone("UTC")); until = formatter.parse(rule.get("UNTIL")).getTime(); }
            java.time.ZoneId zone = java.time.ZoneId.systemDefault();
            java.time.ZonedDateTime first = java.time.Instant.ofEpochMilli(origin).atZone(zone); java.time.LocalDate current = java.time.Instant.ofEpochMilli(after).atZone(zone).toLocalDate();
            java.time.LocalDate originDay = first.toLocalDate(); int interval = Integer.parseInt(rule.getOrDefault("INTERVAL", "1")); if (interval < 1) throw new Exception("Invalid recurrence interval");
            String frequency = rule.getOrDefault("FREQ", "DAILY");
            for (int offset = 0; offset <= 36600; offset++) {
                java.time.LocalDate candidate = current.plusDays(offset); long millis = candidate.atTime(first.toLocalTime()).atZone(zone).toInstant().toEpochMilli();
                if (millis <= after) continue; if (millis > until) break;
                if (!matchesRecurrenceDay(candidate, originDay, frequency, interval, rule)) continue;
                if (rule.containsKey("BYSETPOS")) {
                    java.time.LocalDate start, end;
                    if (frequency.equals("WEEKLY")) { start = candidate.with(java.time.temporal.TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY)); end = start.plusWeeks(1); }
                    else if (frequency.equals("MONTHLY")) { start = candidate.withDayOfMonth(1); end = start.plusMonths(1); }
                    else if (frequency.equals("YEARLY")) { start = candidate.withDayOfYear(1); end = start.plusYears(1); }
                    else { start = candidate; end = start.plusDays(1); }
                    List<java.time.LocalDate> matches = new ArrayList<>();
                    for (java.time.LocalDate day = start; day.isBefore(end); day = day.plusDays(1)) if (matchesRecurrenceDay(day, originDay, frequency, interval, rule)) matches.add(day);
                    int position = matches.indexOf(candidate); boolean accepted = false;
                    for (String raw : rule.get("BYSETPOS").split(",")) { int n = Integer.parseInt(raw); if (n > 0 && position == n - 1 || n < 0 && position == matches.size() + n) accepted = true; }
                    if (!accepted) continue;
                }
                if (best == -1 || millis < best) best = millis; break;
            }
        }
        return best;
    }
    private static boolean matchesRecurrenceDay(java.time.LocalDate day, java.time.LocalDate origin, String frequency, int interval, Map<String, String> rule) {
        if (day.isBefore(origin)) return false;
        long period;
        if (frequency.equals("DAILY")) period = java.time.temporal.ChronoUnit.DAYS.between(origin, day);
        else if (frequency.equals("WEEKLY")) period = java.time.temporal.ChronoUnit.WEEKS.between(origin.with(java.time.temporal.TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY)), day.with(java.time.temporal.TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY)));
        else if (frequency.equals("MONTHLY")) period = java.time.temporal.ChronoUnit.MONTHS.between(origin.withDayOfMonth(1), day.withDayOfMonth(1));
        else if (frequency.equals("YEARLY")) period = day.getYear() - origin.getYear(); else return false;
        if (period % interval != 0) return false;
        if (!matchNumber(rule.get("BYMONTH"), day.getMonthValue(), 12)) return false;
        if (!matchNumber(rule.get("BYMONTHDAY"), day.getDayOfMonth(), day.lengthOfMonth())) return false;
        if (!matchNumber(rule.get("BYYEARDAY"), day.getDayOfYear(), day.lengthOfYear())) return false;
        int week = day.get(java.time.temporal.WeekFields.ISO.weekOfWeekBasedYear()), lastWeek = day.withMonth(12).withDayOfMonth(28).get(java.time.temporal.WeekFields.ISO.weekOfWeekBasedYear());
        if (!matchNumber(rule.get("BYWEEKNO"), week, lastWeek)) return false;
        if (rule.containsKey("BYDAY")) { String[] names = {"MO", "TU", "WE", "TH", "FR", "SA", "SU"}; if (!Arrays.asList(rule.get("BYDAY").split(",")).contains(names[day.getDayOfWeek().getValue() - 1])) return false; }
        else if (frequency.equals("WEEKLY") && day.getDayOfWeek() != origin.getDayOfWeek()) return false;
        if (frequency.equals("MONTHLY") && !rule.containsKey("BYMONTHDAY") && !rule.containsKey("BYDAY") && day.getDayOfMonth() != origin.getDayOfMonth()) return false;
        if (frequency.equals("YEARLY") && !rule.containsKey("BYYEARDAY") && !rule.containsKey("BYWEEKNO") && !rule.containsKey("BYDAY") && !rule.containsKey("BYMONTHDAY")) {
            if (day.getDayOfMonth() != origin.getDayOfMonth()) return false; if (!rule.containsKey("BYMONTH") && day.getMonthValue() != origin.getMonthValue()) return false;
        }
        return true;
    }
    private static boolean matchNumber(String selectors, int value, int length) { if (selectors == null) return true; for (String raw : selectors.split(",")) { int n = Integer.parseInt(raw); if (n > 0 && value == n || n < 0 && value == length + n + 1) return true; } return false; }
    private static String containerId(String account, String type) { if (account.isEmpty() && type.isEmpty()) return "local"; return Base64.encodeToString((type + "\n" + account).getBytes(StandardCharsets.UTF_8), Base64.URL_SAFE | Base64.NO_WRAP); }
    private static String[] containerAccount(String id) throws Exception {
        if (id == null || id.isEmpty() || id.equals("local")) return new String[]{null, null};
        String value = new String(Base64.decode(id, Base64.URL_SAFE), StandardCharsets.UTF_8); int split = value.indexOf('\n'); if (split < 0) throw new Exception("Invalid contacts container");
        return new String[]{value.substring(split + 1), value.substring(0, split)};
    }
    private JSONArray containers() throws Exception {
        LinkedHashMap<String, JSONObject> found = new LinkedHashMap<>();
        try (Cursor cursor = resolver.query(ContactsContract.RawContacts.CONTENT_URI, new String[]{ContactsContract.RawContacts.ACCOUNT_NAME, ContactsContract.RawContacts.ACCOUNT_TYPE}, ContactsContract.RawContacts.DELETED + "=0", null, null)) {
            if (cursor == null) throw new Exception("The Android Contacts provider is unavailable");
            while (cursor.moveToNext()) {
                String account = string(cursor, ContactsContract.RawContacts.ACCOUNT_NAME), type = string(cursor, ContactsContract.RawContacts.ACCOUNT_TYPE), id = containerId(account, type);
                if (!found.containsKey(id)) found.put(id, new JSONObject().put("identifier", id).put("name", account.isEmpty() ? "设备联系人 / Device contacts" : account));
            }
        }
        if (found.isEmpty()) found.put("local", new JSONObject().put("identifier", "local").put("name", "设备联系人 / Device contacts"));
        return new JSONArray(found.values());
    }
    private JSONArray groups(JSONObject p) throws Exception {
        Set<String> containers = selected(p.optJSONArray("containers")); JSONArray result = new JSONArray();
        try (Cursor cursor = resolver.query(ContactsContract.Groups.CONTENT_URI, new String[]{ContactsContract.Groups._ID, ContactsContract.Groups.TITLE, ContactsContract.Groups.ACCOUNT_NAME, ContactsContract.Groups.ACCOUNT_TYPE}, ContactsContract.Groups.DELETED + "=0", null, ContactsContract.Groups.TITLE + " ASC")) {
            if (cursor == null) throw new Exception("Cannot read contact groups");
            while (cursor.moveToNext()) {
                String account = containerId(string(cursor, ContactsContract.Groups.ACCOUNT_NAME), string(cursor, ContactsContract.Groups.ACCOUNT_TYPE));
                if (containers != null && !containers.contains(account)) continue;
                result.put(new JSONObject().put("identifier", string(cursor, ContactsContract.Groups._ID)).put("name", string(cursor, ContactsContract.Groups.TITLE)).put("containerIdentifier", account));
            }
        }
        return result;
    }
    private JSONArray contacts(JSONObject p) throws Exception {
        Set<String> containers = selected(p.optJSONArray("containers")), groups = selected(p.optJSONArray("groups")), groupMembers = null;
        if (groups != null) {
            groupMembers = new HashSet<>();
            try (Cursor cursor = resolver.query(ContactsContract.Data.CONTENT_URI, new String[]{ContactsContract.Data.RAW_CONTACT_ID, ContactsContract.CommonDataKinds.GroupMembership.GROUP_ROW_ID}, ContactsContract.Data.MIMETYPE + "=?", new String[]{ContactsContract.CommonDataKinds.GroupMembership.CONTENT_ITEM_TYPE}, null)) {
                if (cursor != null) while (cursor.moveToNext()) if (groups.contains(string(cursor, ContactsContract.CommonDataKinds.GroupMembership.GROUP_ROW_ID))) groupMembers.add(string(cursor, ContactsContract.Data.RAW_CONTACT_ID));
            }
        }
        JSONArray result = new JSONArray();
        try (Cursor cursor = resolver.query(ContactsContract.RawContacts.CONTENT_URI, new String[]{ContactsContract.RawContacts._ID, ContactsContract.RawContacts.ACCOUNT_NAME, ContactsContract.RawContacts.ACCOUNT_TYPE}, ContactsContract.RawContacts.DELETED + "=0", null, ContactsContract.RawContacts._ID + " ASC")) {
            if (cursor == null) throw new Exception("Cannot read contacts");
            while (cursor.moveToNext()) {
                String id = string(cursor, ContactsContract.RawContacts._ID), account = containerId(string(cursor, ContactsContract.RawContacts.ACCOUNT_NAME), string(cursor, ContactsContract.RawContacts.ACCOUNT_TYPE));
                if (containers != null && !containers.contains(account) || groupMembers != null && !groupMembers.contains(id)) continue;
                if (result.length() >= 2000) throw new Exception("More than 2000 raw contacts matched. Filter by a contacts container or group.");
                result.put(contact(id).put("containerIdentifier", account));
            }
        }
        return result;
    }
    private JSONObject contact(String rawId) throws Exception {
        JSONObject result = new JSONObject().put("identifier", "contact:" + rawId).put("birthday", JSONObject.NULL).put("image", JSONObject.NULL);
        for (String field : new String[]{"namePrefix", "givenName", "middleName", "familyName", "nickname", "note", "organizationName", "departmentName", "jobTitle"}) result.put(field, "");
        for (String field : new String[]{"emailAddresses", "phoneNumbers", "postalAddresses", "socialProfiles", "urlAddresses", "dates"}) result.put(field, new JSONArray());
        try (Cursor cursor = resolver.query(ContactsContract.Data.CONTENT_URI, null, ContactsContract.Data.RAW_CONTACT_ID + "=?", new String[]{rawId}, null)) {
            if (cursor == null) throw new Exception("Cannot read contact details");
            while (cursor.moveToNext()) {
                String mime = string(cursor, ContactsContract.Data.MIMETYPE), identifier = string(cursor, ContactsContract.Data._ID);
                switch (mime) {
                    case ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE:
                        result.put("namePrefix", string(cursor, ContactsContract.CommonDataKinds.StructuredName.PREFIX)).put("givenName", string(cursor, ContactsContract.CommonDataKinds.StructuredName.GIVEN_NAME)).put("middleName", string(cursor, ContactsContract.CommonDataKinds.StructuredName.MIDDLE_NAME)).put("familyName", string(cursor, ContactsContract.CommonDataKinds.StructuredName.FAMILY_NAME)); break;
                    case ContactsContract.CommonDataKinds.Nickname.CONTENT_ITEM_TYPE: result.put("nickname", string(cursor, ContactsContract.CommonDataKinds.Nickname.NAME)); break;
                    case ContactsContract.CommonDataKinds.Note.CONTENT_ITEM_TYPE: result.put("note", string(cursor, ContactsContract.CommonDataKinds.Note.NOTE)); break;
                    case ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE:
                        result.put("organizationName", string(cursor, ContactsContract.CommonDataKinds.Organization.COMPANY)).put("departmentName", string(cursor, ContactsContract.CommonDataKinds.Organization.DEPARTMENT)).put("jobTitle", string(cursor, ContactsContract.CommonDataKinds.Organization.TITLE)); break;
                    case ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE:
                        result.getJSONArray("emailAddresses").put(labeled(identifier, label(cursor), string(cursor, ContactsContract.CommonDataKinds.Email.ADDRESS))); break;
                    case ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE:
                        result.getJSONArray("phoneNumbers").put(labeled(identifier, label(cursor), string(cursor, ContactsContract.CommonDataKinds.Phone.NUMBER))); break;
                    case ContactsContract.CommonDataKinds.Website.CONTENT_ITEM_TYPE:
                        result.getJSONArray("urlAddresses").put(labeled(identifier, label(cursor), string(cursor, ContactsContract.CommonDataKinds.Website.URL))); break;
                    case ContactsContract.CommonDataKinds.StructuredPostal.CONTENT_ITEM_TYPE:
                        result.getJSONArray("postalAddresses").put(new JSONObject().put("identifier", identifier).put("label", label(cursor)).put("localizedLabel", label(cursor))
                                .put("street", string(cursor, ContactsContract.CommonDataKinds.StructuredPostal.STREET)).put("city", string(cursor, ContactsContract.CommonDataKinds.StructuredPostal.CITY))
                                .put("state", string(cursor, ContactsContract.CommonDataKinds.StructuredPostal.REGION)).put("postalCode", string(cursor, ContactsContract.CommonDataKinds.StructuredPostal.POSTCODE)).put("country", string(cursor, ContactsContract.CommonDataKinds.StructuredPostal.COUNTRY)).put("isoCountryCode", "")); break;
                    case ContactsContract.CommonDataKinds.Event.CONTENT_ITEM_TYPE: {
                        String text = string(cursor, ContactsContract.CommonDataKinds.Event.START_DATE); Long millis = parseContactDate(text);
                        if (millis != null && number(cursor, ContactsContract.CommonDataKinds.Event.TYPE) == ContactsContract.CommonDataKinds.Event.TYPE_BIRTHDAY) result.put("birthday", millis);
                        else if (millis != null) result.getJSONArray("dates").put(labeled(identifier, label(cursor), millis)); break;
                    }
                    case ContactsContract.CommonDataKinds.Photo.CONTENT_ITEM_TYPE: {
                        int index = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Photo.PHOTO); if (index >= 0 && !cursor.isNull(index)) { byte[] bytes = cursor.getBlob(index); if (bytes != null && bytes.length < MAX_BYTES) result.put("image", new JSONObject().put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP)).put("mimeType", "image/jpeg")); } break;
                    }
                    case "vnd.dev.scriptable.social": {
                        JSONObject profile = new JSONObject(string(cursor, ContactsContract.Data.DATA1)); profile.put("identifier", identifier); result.getJSONArray("socialProfiles").put(profile); break;
                    }
                    case ContactsContract.CommonDataKinds.Im.CONTENT_ITEM_TYPE: {
                        String protocol = string(cursor, ContactsContract.CommonDataKinds.Im.CUSTOM_PROTOCOL);
                        result.getJSONArray("socialProfiles").put(new JSONObject().put("identifier", identifier).put("label", label(cursor)).put("localizedLabel", label(cursor)).put("service", protocol).put("url", "").put("userIdentifier", JSONObject.NULL).put("username", string(cursor, ContactsContract.CommonDataKinds.Im.DATA))); break;
                    }
                }
            }
        }
        return result;
    }
    private static String label(Cursor cursor) { String custom = string(cursor, ContactsContract.Data.DATA3); if (!custom.isEmpty()) return custom; long type = number(cursor, ContactsContract.Data.DATA2); return type == 1 ? "Home" : type == 2 ? "Mobile" : type == 3 ? "Work" : "Other"; }
    private static JSONObject labeled(String id, String label, Object value) throws Exception { return new JSONObject().put("identifier", id).put("label", label).put("localizedLabel", label).put("value", value); }
    private static Long parseContactDate(String text) {
        try { if (text.startsWith("--")) text = "2000" + text.substring(1); return java.time.LocalDate.parse(text.substring(0, 10)).atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli(); } catch (Exception ignored) { return null; }
    }
    private static String rawId(String id) throws Exception { if (!id.matches("contact:[0-9]+")) throw new Exception("Invalid Android contact identifier"); return id.substring(8); }
    private static ContentProviderOperation.Builder dataInsert(String mime, long rawId, int rawBackReference) {
        ContentProviderOperation.Builder builder = ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI).withValue(ContactsContract.Data.MIMETYPE, mime);
        if (rawBackReference >= 0) builder.withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, rawBackReference); else builder.withValue(ContactsContract.Data.RAW_CONTACT_ID, rawId); return builder;
    }
    private static ContentProviderOperation.Builder labeledInsert(String mime, long rawId, int reference, JSONObject entry) {
        return dataInsert(mime, rawId, reference).withValue(ContactsContract.Data.DATA2, 0).withValue(ContactsContract.Data.DATA3, entry.optString("label", "Other"));
    }
    private JSONArray persistContacts(JSONObject p) throws Exception {
        JSONArray changes = p.getJSONArray("changes"); if (changes.length() > 100) throw new Exception("Persist at most 100 contact/group changes at a time");
        ArrayList<ContentProviderOperation> operations = new ArrayList<>(); ArrayList<Integer> references = new ArrayList<>(); ArrayList<String> resultIds = new ArrayList<>(); ArrayList<JSONObject> memberships = new ArrayList<>();
        for (int index = 0; index < changes.length(); index++) {
            JSONObject change = changes.getJSONObject(index), value = change.getJSONObject("value"); String op = change.getString("op"), type = change.getString("type");
            int reference = -1; String identifier = value.optString("identifier");
            if (!Arrays.asList("add", "update", "delete").contains(op)) throw new Exception("Unknown contact change");
            if (type.equals("contact")) {
                long raw = op.equals("add") ? -1 : Long.parseLong(rawId(identifier));
                if (op.equals("delete")) operations.add(ContentProviderOperation.newDelete(ContentUris.withAppendedId(ContactsContract.RawContacts.CONTENT_URI, raw)).withExpectedCount(1).build());
                else {
                    if (op.equals("add")) {
                        String[] account = containerAccount(change.optString("containerIdentifier", "local")); reference = operations.size();
                        operations.add(ContentProviderOperation.newInsert(ContactsContract.RawContacts.CONTENT_URI).withValue(ContactsContract.RawContacts.ACCOUNT_NAME, account[0]).withValue(ContactsContract.RawContacts.ACCOUNT_TYPE, account[1]).build());
                    } else {
                        String selection = ContactsContract.Data.RAW_CONTACT_ID + "=? AND " + ContactsContract.Data.MIMETYPE + " IN (?,?,?,?,?,?,?,?,?,?,?)";
                        operations.add(ContentProviderOperation.newDelete(ContactsContract.Data.CONTENT_URI).withSelection(selection, new String[]{String.valueOf(raw), ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE,
                                ContactsContract.CommonDataKinds.Nickname.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.Note.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE,
                                ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.StructuredPostal.CONTENT_ITEM_TYPE,
                                ContactsContract.CommonDataKinds.Website.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.Event.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.Photo.CONTENT_ITEM_TYPE, "vnd.dev.scriptable.social"}).build());
                    }
                    appendContactData(operations, value, raw, reference);
                }
            } else if (type.equals("group")) {
                if (op.equals("delete")) operations.add(ContentProviderOperation.newDelete(ContentUris.withAppendedId(ContactsContract.Groups.CONTENT_URI, Long.parseLong(identifier))).withExpectedCount(1).build());
                else {
                    if (value.optString("name").isEmpty()) throw new Exception("A contact group requires a name");
                    if (op.equals("add")) {
                        reference = operations.size(); String[] account = containerAccount(change.optString("containerIdentifier", "local"));
                        operations.add(ContentProviderOperation.newInsert(ContactsContract.Groups.CONTENT_URI).withValue(ContactsContract.Groups.TITLE, value.getString("name")).withValue(ContactsContract.Groups.ACCOUNT_NAME, account[0]).withValue(ContactsContract.Groups.ACCOUNT_TYPE, account[1]).build());
                    } else operations.add(ContentProviderOperation.newUpdate(ContentUris.withAppendedId(ContactsContract.Groups.CONTENT_URI, Long.parseLong(identifier))).withValue(ContactsContract.Groups.TITLE, value.getString("name")).withExpectedCount(1).build());
                    JSONArray members = value.optJSONArray("members");
                    if (members != null) for (int j = 0; j < members.length(); j++) {
                        JSONObject member = new JSONObject(members.getJSONObject(j).toString()).put("_groupReference", reference).put("_groupIdentifier", identifier);
                        memberships.add(member); // Append only after every new raw contact/group has an insertion back-reference.
                    }
                }
            } else throw new Exception("Unknown contact change type");
            references.add(reference); resultIds.add(identifier);
            if (operations.size() > 1000) throw new Exception("The contact transaction exceeds 1000 data rows");
        }
        for (JSONObject member : memberships) {
            int rawReference = -1, groupReference = member.optInt("_groupReference", -1); String raw = "0", group = member.optString("_groupIdentifier", "0");
            if (member.has("reference")) {
                int index = member.getInt("reference");
                if (index < 0 || index >= changes.length() || !changes.getJSONObject(index).getString("type").equals("contact") || !changes.getJSONObject(index).getString("op").equals("add")) throw new Exception("Invalid queued contact membership reference");
                rawReference = references.get(index);
            } else raw = rawId(member.getString("identifier"));
            if (member.getString("op").equals("add")) {
                ContentProviderOperation.Builder insert = dataInsert(ContactsContract.CommonDataKinds.GroupMembership.CONTENT_ITEM_TYPE, Long.parseLong(raw), rawReference);
                if (groupReference >= 0) insert.withValueBackReference(ContactsContract.CommonDataKinds.GroupMembership.GROUP_ROW_ID, groupReference); else insert.withValue(ContactsContract.CommonDataKinds.GroupMembership.GROUP_ROW_ID, Long.parseLong(group));
                operations.add(insert.build());
            } else {
                ContentProviderOperation.Builder delete = ContentProviderOperation.newDelete(ContactsContract.Data.CONTENT_URI).withSelection(ContactsContract.Data.RAW_CONTACT_ID + "=? AND " + ContactsContract.Data.MIMETYPE + "=? AND " + ContactsContract.CommonDataKinds.GroupMembership.GROUP_ROW_ID + "=?", new String[]{raw, ContactsContract.CommonDataKinds.GroupMembership.CONTENT_ITEM_TYPE, group});
                if (rawReference >= 0) delete.withSelectionBackReference(0, rawReference); if (groupReference >= 0) delete.withSelectionBackReference(2, groupReference); operations.add(delete.build());
            }
            if (operations.size() > 1000) throw new Exception("The contact transaction exceeds 1000 data rows");
        }
        if (Thread.currentThread().isInterrupted()) throw new InterruptedException("Script stopped before contacts were saved");
        ContentProviderResult[] saved = resolver.applyBatch(ContactsContract.AUTHORITY, operations); JSONArray result = new JSONArray();
        for (int i = 0; i < changes.length(); i++) {
            String id = resultIds.get(i); int reference = references.get(i);
            if (reference >= 0) { Uri uri = saved[reference].uri; if (uri == null) throw new Exception("The Contacts provider returned no identifier"); id = (changes.getJSONObject(i).getString("type").equals("contact") ? "contact:" : "") + uri.getLastPathSegment(); }
            result.put(new JSONObject().put("identifier", id));
        }
        return result;
    }
    private static void appendContactData(ArrayList<ContentProviderOperation> operations, JSONObject value, long raw, int reference) throws Exception {
        operations.add(dataInsert(ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE, raw, reference)
                .withValue(ContactsContract.CommonDataKinds.StructuredName.PREFIX, value.optString("namePrefix")).withValue(ContactsContract.CommonDataKinds.StructuredName.GIVEN_NAME, value.optString("givenName"))
                .withValue(ContactsContract.CommonDataKinds.StructuredName.MIDDLE_NAME, value.optString("middleName")).withValue(ContactsContract.CommonDataKinds.StructuredName.FAMILY_NAME, value.optString("familyName")).build());
        if (!value.optString("nickname").isEmpty()) operations.add(dataInsert(ContactsContract.CommonDataKinds.Nickname.CONTENT_ITEM_TYPE, raw, reference).withValue(ContactsContract.CommonDataKinds.Nickname.NAME, value.getString("nickname")).build());
        if (!value.optString("note").isEmpty()) operations.add(dataInsert(ContactsContract.CommonDataKinds.Note.CONTENT_ITEM_TYPE, raw, reference).withValue(ContactsContract.CommonDataKinds.Note.NOTE, value.getString("note")).build());
        if (!value.optString("organizationName").isEmpty() || !value.optString("departmentName").isEmpty() || !value.optString("jobTitle").isEmpty()) operations.add(dataInsert(ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE, raw, reference)
                .withValue(ContactsContract.CommonDataKinds.Organization.COMPANY, value.optString("organizationName")).withValue(ContactsContract.CommonDataKinds.Organization.DEPARTMENT, value.optString("departmentName")).withValue(ContactsContract.CommonDataKinds.Organization.TITLE, value.optString("jobTitle")).build());
        String[][] fields = {{"emailAddresses", ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.Email.ADDRESS},
                {"phoneNumbers", ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.Phone.NUMBER}, {"urlAddresses", ContactsContract.CommonDataKinds.Website.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.Website.URL}};
        for (String[] field : fields) { JSONArray entries = value.optJSONArray(field[0]); if (entries != null) for (int j = 0; j < entries.length(); j++) { JSONObject entry = entries.getJSONObject(j); operations.add(labeledInsert(field[1], raw, reference, entry).withValue(field[2], entry.getString("value")).build()); } }
        JSONArray addresses = value.optJSONArray("postalAddresses");
        if (addresses != null) for (int j = 0; j < addresses.length(); j++) {
            JSONObject entry = addresses.getJSONObject(j); operations.add(labeledInsert(ContactsContract.CommonDataKinds.StructuredPostal.CONTENT_ITEM_TYPE, raw, reference, entry)
                    .withValue(ContactsContract.CommonDataKinds.StructuredPostal.STREET, entry.optString("street")).withValue(ContactsContract.CommonDataKinds.StructuredPostal.CITY, entry.optString("city"))
                    .withValue(ContactsContract.CommonDataKinds.StructuredPostal.REGION, entry.optString("state")).withValue(ContactsContract.CommonDataKinds.StructuredPostal.POSTCODE, entry.optString("postalCode")).withValue(ContactsContract.CommonDataKinds.StructuredPostal.COUNTRY, entry.optString("country")).build());
        }
        if (!value.isNull("birthday") && value.has("birthday")) operations.add(dataInsert(ContactsContract.CommonDataKinds.Event.CONTENT_ITEM_TYPE, raw, reference).withValue(ContactsContract.CommonDataKinds.Event.TYPE, ContactsContract.CommonDataKinds.Event.TYPE_BIRTHDAY).withValue(ContactsContract.CommonDataKinds.Event.START_DATE, contactDate(value.get("birthday"))).build());
        JSONArray dates = value.optJSONArray("dates"); if (dates != null) for (int j = 0; j < dates.length(); j++) { JSONObject entry = dates.getJSONObject(j); operations.add(labeledInsert(ContactsContract.CommonDataKinds.Event.CONTENT_ITEM_TYPE, raw, reference, entry).withValue(ContactsContract.CommonDataKinds.Event.START_DATE, contactDate(entry.get("value"))).build()); }
        JSONObject image = value.optJSONObject("image"); if (image != null) { byte[] bytes = Base64.decode(image.getString("base64"), Base64.DEFAULT); checkBytes(bytes); operations.add(dataInsert(ContactsContract.CommonDataKinds.Photo.CONTENT_ITEM_TYPE, raw, reference).withValue(ContactsContract.CommonDataKinds.Photo.PHOTO, bytes).build()); }
        JSONArray social = value.optJSONArray("socialProfiles"); if (social != null) for (int j = 0; j < social.length(); j++) operations.add(dataInsert("vnd.dev.scriptable.social", raw, reference).withValue(ContactsContract.Data.DATA1, social.getJSONObject(j).toString()).build());
    }
    private static String contactDate(Object value) throws Exception {
        long millis; if (value instanceof Number) millis = ((Number) value).longValue(); else millis = java.time.Instant.parse(String.valueOf(value)).toEpochMilli();
        return java.time.Instant.ofEpochMilli(millis).atZone(java.time.ZoneId.systemDefault()).toLocalDate().toString();
    }
    private List<Uri> latestPhotoUris(JSONObject p) throws Exception {
        int count = p.optInt("count", 1); if (count < 1 || count > 100) throw new Exception("Photo count must be from 1 to 100");
        boolean screenshot = p.optBoolean("screenshots"); List<Uri> result = new ArrayList<>();
        String selection = screenshot ? MediaStore.Images.Media.DISPLAY_NAME + " LIKE ? OR " + MediaStore.Images.Media.BUCKET_DISPLAY_NAME + " LIKE ? OR " + MediaStore.Images.Media.BUCKET_DISPLAY_NAME + " LIKE ? OR " + MediaStore.Images.Media.BUCKET_DISPLAY_NAME + " LIKE ?" : null;
        String[] args = screenshot ? new String[]{"%screenshot%", "%screenshot%", "%截屏%", "%屏幕截图%"} : null;
        try (Cursor cursor = resolver.query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, new String[]{MediaStore.Images.Media._ID}, selection, args, MediaStore.Images.Media.DATE_ADDED + " DESC, " + MediaStore.Images.Media._ID + " DESC")) {
            if (cursor == null) throw new Exception("The Android Photos provider is unavailable");
            while (cursor.moveToNext() && result.size() < count) result.add(ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cursor.getLong(0)));
        }
        return result;
    }
    private JSONArray latestPhotos(JSONObject p) throws Exception { JSONArray result = new JSONArray(); for (Uri uri : latestPhotoUris(p)) result.put(readImage(uri)); return result; }
    private JSONObject readImage(Uri uri) throws Exception {
        BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true;
        try (InputStream input = resolver.openInputStream(uri)) { BitmapFactory.decodeStream(input, null, options); }
        if (options.outWidth <= 0 || options.outHeight <= 0) throw new Exception("The selected content is not a decodable image");
        options.inSampleSize = 1; while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 2048) options.inSampleSize *= 2;
        options.inJustDecodeBounds = false;
        Bitmap bitmap; try (InputStream input = resolver.openInputStream(uri)) { bitmap = BitmapFactory.decodeStream(input, null, options); }
        if (bitmap == null) throw new Exception("Android could not decode the image");
        try {
            int orientation = 1;
            try (InputStream input = resolver.openInputStream(uri)) { orientation = new android.media.ExifInterface(input).getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, 1); } catch (Exception ignored) {}
            android.graphics.Matrix transform = new android.graphics.Matrix();
            if (orientation == 2) transform.setScale(-1, 1); else if (orientation == 3) transform.setRotate(180); else if (orientation == 4) transform.setScale(1, -1);
            else if (orientation == 5) { transform.setRotate(90); transform.postScale(-1, 1); } else if (orientation == 6) transform.setRotate(90);
            else if (orientation == 7) { transform.setRotate(270); transform.postScale(-1, 1); } else if (orientation == 8) transform.setRotate(270);
            if (!transform.isIdentity()) { Bitmap corrected = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), transform, true); if (corrected != bitmap) { bitmap.recycle(); bitmap = corrected; } }
            boolean alpha = bitmap.hasAlpha(); String mime = alpha ? "image/png" : "image/jpeg";
            ByteArrayOutputStream output = new ByteArrayOutputStream(); bitmap.compress(alpha ? Bitmap.CompressFormat.PNG : Bitmap.CompressFormat.JPEG, 92, output);
            byte[] bytes = output.toByteArray(); checkBytes(bytes);
            return new JSONObject().put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP)).put("mimeType", mime).put("width", bitmap.getWidth()).put("height", bitmap.getHeight());
        } finally { bitmap.recycle(); }
    }
    private JSONObject savePhoto(JSONObject p) throws Exception {
        byte[] bytes = Base64.decode(p.getString("base64"), Base64.DEFAULT); checkBytes(bytes);
        BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true; BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (options.outWidth <= 0 || options.outHeight <= 0) throw new Exception("The image data is invalid");
        String mime = options.outMimeType == null ? p.optString("mimeType", "image/png") : options.outMimeType;
        String name = "Scriptable-" + UUID.randomUUID() + (mime.equals("image/jpeg") ? ".jpg" : ".png");
        ContentValues values = new ContentValues(); values.put(MediaStore.Images.Media.DISPLAY_NAME, name); values.put(MediaStore.Images.Media.MIME_TYPE, mime);
        if (Build.VERSION.SDK_INT >= 29) { values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Scriptable"); values.put(MediaStore.Images.Media.IS_PENDING, 1); }
        else { File directory = new File(android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_PICTURES), "Scriptable"); if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("Cannot create the Pictures/Scriptable directory"); values.put(MediaStore.Images.Media.DATA, new File(directory, name).getAbsolutePath()); }
        Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values); if (uri == null) throw new Exception("Android could not create the photo");
        try {
            try (OutputStream output = resolver.openOutputStream(uri, "w")) { if (output == null) throw new Exception("Cannot write the photo"); output.write(bytes); }
            if (Build.VERSION.SDK_INT >= 29) { ContentValues published = new ContentValues(); published.put(MediaStore.Images.Media.IS_PENDING, 0); resolver.update(uri, published, null, null); }
            return new JSONObject().put("uri", uri.toString());
        } catch (Exception error) { resolver.delete(uri, null, null); throw error; }
    }
    private void removePhotos(PendingAction r, List<Uri> values) {
        if (!active.contains(r.id)) return;
        if (values.isEmpty()) { finish(r.id, true); return; }
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                int code = nextRequest++; requests.put(code, r);
                try { activity.startIntentSenderForResult(MediaStore.createDeleteRequest(resolver, values).getIntentSender(), code, null, 0, 0, 0); }
                catch (Exception error) { requests.remove(code); throw error; }
            } else {
                AlertDialog dialog = new AlertDialog.Builder(activity).setTitle("删除照片 / Delete photos").setMessage("删除 " + values.size() + " 张照片？此操作无法撤销。")
                        .setNegativeButton("取消", (d, which) -> fail(r.id, new Exception("User cancelled photo deletion")))
                        .setPositiveButton("删除", (d, which) -> { r.uris = values; removeLegacyPhotos(r); }).create(); show(r, dialog);
            }
        } catch (Exception error) { fail(r.id, error); }
    }
    private void removeLegacyPhotos(PendingAction r) {
        background(r, () -> {
            while (r.photoIndex < r.uris.size()) {
                if (!active.contains(r.id) || Thread.currentThread().isInterrupted()) throw new InterruptedException("Script stopped");
                try { resolver.delete(r.uris.get(r.photoIndex), null, null); r.photoIndex++; }
                catch (SecurityException error) {
                    if (Build.VERSION.SDK_INT >= 29 && error instanceof android.app.RecoverableSecurityException) {
                        android.app.RecoverableSecurityException recoverable = (android.app.RecoverableSecurityException) error;
                        main.post(() -> {
                            if (!active.contains(r.id)) return;
                            int code = nextRequest++; requests.put(code, r);
                            try { activity.startIntentSenderForResult(recoverable.getUserAction().getActionIntent().getIntentSender(), code, null, 0, 0, 0); }
                            catch (Exception failure) { requests.remove(code); fail(r.id, failure); }
                        }); return Deferred.INSTANCE;
                    }
                    throw error;
                }
            }
            return new JSONObject().put("removed", r.photoIndex);
        });
    }
    private JSONObject importDocuments(JSONObject p, List<Uri> uris) throws Exception {
        ScriptRepository repository = new ScriptRepository(context);
        String directory = "/documents/import-" + UUID.randomUUID(); repository.fileOperation(new JSONObject().put("op", "createDirectory").put("path", directory));
        JSONArray paths = new JSONArray(); int[] budget = {MAX_BYTES}, count = {0};
        try {
            if (p.optBoolean("folder")) {
                Uri tree = uris.get(0); Uri root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                importTree(repository, tree, root, directory, budget, count, 0); paths.put(directory);
            } else {
                Set<String> importedNames = new HashSet<>();
                for (Uri uri : uris) {
                    String baseName = safeName(displayName(uri)), name = baseName; int suffix = 1;
                    while (!importedNames.add(name)) name = suffix++ + "-" + baseName;
                    String path = directory + "/" + name;
                    byte[] bytes = read(resolver.openInputStream(uri), budget[0]); budget[0] -= bytes.length; if (++count[0] > 200) throw new Exception("Import at most 200 documents at a time");
                    // Repository validates both raw storage and prospective serialized bootstrap capacity before committing each write.
                    repository.fileOperation(new JSONObject().put("op", "write").put("path", path).put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))); paths.put(path);
                }
            }
            return new JSONObject().put("paths", paths).put("files", repository.fileSnapshot());
        } catch (Exception error) {
            try { repository.fileOperation(new JSONObject().put("op", "remove").put("path", directory)); } catch (Exception ignored) {}
            throw error;
        }
    }
    private void importTree(ScriptRepository repository, Uri tree, Uri root, String destination, int[] budget, int[] count, int depth) throws Exception {
        if (depth > 12) throw new Exception("Folder nesting exceeds 12 levels");
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getDocumentId(root));
        try (Cursor cursor = resolver.query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
            if (cursor == null) throw new Exception("Cannot enumerate the selected folder");
            Set<String> names = new HashSet<>();
            while (cursor.moveToNext()) {
                if (++count[0] > 200) throw new Exception("Import at most 200 folder items at a time");
                String name = safeName(cursor.getString(1)); if (!names.add(name)) throw new Exception("Folder entries have colliding names after Android path sanitization");
                String path = destination + "/" + name; Uri uri = DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(0));
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(cursor.getString(2))) { repository.fileOperation(new JSONObject().put("op", "createDirectory").put("path", path)); importTree(repository, tree, uri, path, budget, count, depth + 1); }
                else { byte[] bytes = read(resolver.openInputStream(uri), budget[0]); budget[0] -= bytes.length; repository.fileOperation(new JSONObject().put("op", "write").put("path", path).put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))); }
            }
        }
    }
    private String displayName(Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) { if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) return cursor.getString(0); } catch (Exception ignored) {}
        return "Document.bin";
    }
    private void datePicker(PendingAction r) throws Exception {
        JSONObject p = r.payload; String mode = p.optString("mode", "date");
        if (mode.equals("countdown")) {
            LinearLayout panel = new LinearLayout(activity); panel.setPadding(24, 12, 24, 12);
            NumberPicker hours = new NumberPicker(activity); hours.setMinValue(0); hours.setMaxValue(23);
            NumberPicker minutes = new NumberPicker(activity); minutes.setMinValue(0); minutes.setMaxValue(59);
            int seconds = p.optInt("countdownDuration"); if (seconds < 0 || seconds > 86399) throw new Exception("Countdown duration must be between 0 and 86399 seconds");
            hours.setValue(seconds / 3600); minutes.setValue(seconds % 3600 / 60); panel.addView(hours); panel.addView(minutes);
            show(r, new AlertDialog.Builder(activity).setTitle("倒计时 / Countdown: 小时 · 分钟").setView(panel).setPositiveButton("选择", (dialog, which) -> finish(r.id, hours.getValue() * 3600 + minutes.getValue() * 60)).setNegativeButton("取消", (dialog, which) -> fail(r.id, new Exception("User cancelled countdown picker"))).create()); return;
        }
        Calendar initial = Calendar.getInstance(); initial.setTimeInMillis(p.optLong("initialDate", System.currentTimeMillis()));
        if (p.has("minimumDate") && !p.isNull("minimumDate") && p.has("maximumDate") && !p.isNull("maximumDate") && p.getLong("maximumDate") < p.getLong("minimumDate")) throw new Exception("Maximum date precedes minimum date");
        if (mode.equals("time")) { timePicker(r, initial); return; }
        DatePickerDialog picker = new DatePickerDialog(activity, (view, year, month, day) -> {
            initial.set(year, month, day); initial.set(Calendar.SECOND, 0); initial.set(Calendar.MILLISECOND, 0);
            if (mode.equals("datetime")) timePicker(r, initial); else { initial.set(Calendar.HOUR_OF_DAY, 0); initial.set(Calendar.MINUTE, 0); finishDate(r, initial.getTimeInMillis()); }
        }, initial.get(Calendar.YEAR), initial.get(Calendar.MONTH), initial.get(Calendar.DAY_OF_MONTH));
        if (p.has("minimumDate") && !p.isNull("minimumDate")) picker.getDatePicker().setMinDate(p.getLong("minimumDate"));
        if (p.has("maximumDate") && !p.isNull("maximumDate")) picker.getDatePicker().setMaxDate(p.getLong("maximumDate"));
        show(r, picker);
    }
    private void timePicker(PendingAction r, Calendar initial) {
        TimePickerDialog picker = new TimePickerDialog(activity, (view, hour, minute) -> {
            int interval = Math.max(1, r.payload.optInt("minuteInterval", 1));
            initial.set(Calendar.HOUR_OF_DAY, hour); initial.set(Calendar.MINUTE, minute / interval * interval); initial.set(Calendar.SECOND, 0); initial.set(Calendar.MILLISECOND, 0); finishDate(r, initial.getTimeInMillis());
        }, initial.get(Calendar.HOUR_OF_DAY), initial.get(Calendar.MINUTE), android.text.format.DateFormat.is24HourFormat(activity));
        show(r, picker);
    }
    private void finishDate(PendingAction r, long millis) {
        try {
            JSONObject p = r.payload;
            if (p.has("minimumDate") && !p.isNull("minimumDate") && millis < p.getLong("minimumDate") || p.has("maximumDate") && !p.isNull("maximumDate") && millis > p.getLong("maximumDate")) throw new Exception("The selected date is outside minimumDate / maximumDate");
            finish(r.id, millis);
        } catch (Exception error) { fail(r.id, error); }
    }
    private void previewDocument(PendingAction r) {
        background(r, () -> {
            byte[] bytes = Base64.decode(r.payload.getString("base64"), Base64.DEFAULT); checkBytes(bytes);
            Uri uri = sharedFile(bytes, r.payload.optString("name", "Document.bin")); String mime = r.payload.optString("mimeType", "application/octet-stream");
            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.setClipData(ClipData.newRawUri("Document preview", uri));
            main.post(() -> {
                if (!active.contains(r.id)) { deleteShared(uri); return; }
                try { activity.startActivity(intent); finish(r.id, new JSONObject().put("status", "externalViewerOpened")); }
                catch (Exception error) { deleteShared(uri); fail(r.id, new Exception("Install an Android app that can preview " + mime + " documents, then run QuickLook again", error)); }
            }); return Deferred.INSTANCE;
        });
    }
    private void shareItems(PendingAction r) {
        background(r, () -> {
            JSONArray items = r.payload.getJSONArray("items"); if (items.length() == 0 || items.length() > 20) throw new Exception("Share between 1 and 20 items");
            ArrayList<Uri> streams = new ArrayList<>(); ArrayList<String> text = new ArrayList<>(); List<String> mimeTypes = new ArrayList<>();
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i); String type = item.getString("type");
                if (type.equals("text")) { String value = item.optString("text"); if (value.length() > 100000) throw new Exception("Shared text exceeds 100000 characters"); text.add(value); }
                else if (type.equals("image") || type.equals("data")) {
                    byte[] bytes = Base64.decode(item.getString("base64"), Base64.DEFAULT); checkBytes(bytes);
                    streams.add(sharedFile(bytes, item.optString("name", "Attachment.bin"))); mimeTypes.add(item.optString("mimeType", "application/octet-stream"));
                } else throw new Exception("Unknown shared item type");
            }
            String mime = "text/plain";
            if (!streams.isEmpty()) {
                mime = mimeTypes.get(0); boolean same = true, images = true;
                for (String value : mimeTypes) { if (!value.equals(mime)) same = false; if (!value.startsWith("image/")) images = false; }
                if (!same) mime = images ? "image/*" : "*/*";
            }
            Intent intent = new Intent(streams.size() > 1 ? Intent.ACTION_SEND_MULTIPLE : Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_TEXT, String.join("\n", text));
            if (streams.size() == 1) intent.putExtra(Intent.EXTRA_STREAM, streams.get(0)); else if (streams.size() > 1) intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, streams);
            if (!streams.isEmpty()) { ClipData clip = ClipData.newRawUri("Shared attachment", streams.get(0)); for (int i = 1; i < streams.size(); i++) clip.addItem(new ClipData.Item(streams.get(i))); intent.setClipData(clip); intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION); }
            Intent chooser = Intent.createChooser(intent, "分享 / Share").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            main.post(() -> {
                if (!active.contains(r.id)) { for (Uri uri : streams) deleteShared(uri); return; }
                try { activity.startActivity(chooser); finish(r.id, new JSONObject().put("status", "shareChooserOpened").put("sent", JSONObject.NULL)); }
                catch (Exception error) { for (Uri uri : streams) deleteShared(uri); fail(r.id, new Exception("No Android app can receive these shared items", error)); }
            }); return Deferred.INSTANCE;
        });
    }
    private void compose(PendingAction r) {
        background(r, () -> {
            JSONObject p = r.payload; boolean mail = r.action.equals("compose.mail");
            JSONArray attachments = p.optJSONArray("attachments"); ArrayList<Uri> streams = new ArrayList<>(); String attachmentMime = "*/*";
            if (attachments != null) {
                if (attachments.length() > 20) throw new Exception("Compose at most 20 attachments at a time");
                for (int i = 0; i < attachments.length(); i++) { JSONObject attachment = attachments.getJSONObject(i); byte[] bytes = Base64.decode(attachment.getString("base64"), Base64.DEFAULT); checkBytes(bytes); streams.add(sharedFile(bytes, attachment.optString("name", "Attachment.bin"))); if (attachments.length() == 1) attachmentMime = mimeType(attachment.optString("mimeType", "application/octet-stream")); }
            }
            String[] to = recipients(p.optJSONArray("to")), cc = recipients(p.optJSONArray("cc")), bcc = recipients(p.optJSONArray("bcc"));
            String body = p.optString("body"); if (body.length() > 100000) throw new Exception("Composer body is too long");
            Intent intent;
            if (streams.isEmpty()) {
                if (mail) {
                    StringBuilder uri = new StringBuilder("mailto:" + Uri.encode(String.join(",", to), "@,"));
                    uri.append("?subject=").append(Uri.encode(p.optString("subject"))).append("&body=").append(Uri.encode(body));
                    if (cc.length > 0) uri.append("&cc=").append(Uri.encode(String.join(",", cc))); if (bcc.length > 0) uri.append("&bcc=").append(Uri.encode(String.join(",", bcc)));
                    intent = new Intent(Intent.ACTION_SENDTO, Uri.parse(uri.toString()));
                } else intent = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(String.join(";", to), "+;"))).putExtra("sms_body", body);
            } else {
                intent = new Intent(streams.size() == 1 ? Intent.ACTION_SEND : Intent.ACTION_SEND_MULTIPLE).setType(mail ? "message/rfc822" : attachmentMime);
                if (streams.size() == 1) intent.putExtra(Intent.EXTRA_STREAM, streams.get(0)); else intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, streams);
                ClipData clip = ClipData.newRawUri("Attachment", streams.get(0)); for (int i = 1; i < streams.size(); i++) clip.addItem(new ClipData.Item(streams.get(i))); intent.setClipData(clip); intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                if (!mail) { String smsPackage = android.provider.Telephony.Sms.getDefaultSmsPackage(context); if (smsPackage == null) throw new Exception("No default SMS/MMS app is configured"); intent.setPackage(smsPackage).putExtra("address", String.join(";", to)).putExtra("sms_body", body); }
            }
            intent.putExtra(Intent.EXTRA_EMAIL, to).putExtra(Intent.EXTRA_CC, cc).putExtra(Intent.EXTRA_BCC, bcc).putExtra(Intent.EXTRA_SUBJECT, p.optString("subject"));
            if (mail && p.optBoolean("isBodyHTML")) { intent.putExtra(Intent.EXTRA_HTML_TEXT, body).putExtra(Intent.EXTRA_TEXT, Html.fromHtml(body, Html.FROM_HTML_MODE_LEGACY)); } else intent.putExtra(Intent.EXTRA_TEXT, body);
            if (!p.optString("preferredSendingEmailAddress").isEmpty()) intent.putExtra("from", p.optString("preferredSendingEmailAddress"));
            main.post(() -> {
                if (!active.contains(r.id)) return;
                try { activity.startActivity(intent); finish(r.id, new JSONObject().put("status", "externalComposerOpened").put("sent", JSONObject.NULL)); }
                catch (Exception error) { fail(r.id, new Exception("No compatible " + (mail ? "email" : "SMS/MMS") + " app is installed", error)); }
            }); return Deferred.INSTANCE;
        });
    }
    private static String[] recipients(JSONArray values) throws Exception { if (values == null) return new String[0]; if (values.length() > 100) throw new Exception("At most 100 recipients are allowed"); String[] result = new String[values.length()]; for (int i = 0; i < result.length; i++) { result[i] = values.getString(i); if (result[i].length() > 320 || result[i].indexOf('\n') >= 0 || result[i].indexOf('\r') >= 0) throw new Exception("Invalid recipient"); } return result; }
    private Uri sharedFile(byte[] bytes, String displayName) throws Exception {
        File directory = new File(context.getFilesDir(), "shared"); if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("Cannot create private attachment storage");
        File file = new File(directory, UUID.randomUUID() + "-" + safeName(displayName)); try (FileOutputStream output = new FileOutputStream(file)) { output.write(bytes); }
        return new Uri.Builder().scheme("content").authority(context.getPackageName() + ".shared").appendPath(file.getName()).build();
    }
    private void deleteShared(Uri uri) { if (uri == null || !uri.getAuthority().equals(context.getPackageName() + ".shared")) return; try { File file = new File(new File(context.getFilesDir(), "shared"), uri.getLastPathSegment()).getCanonicalFile(); if (file.getParentFile().equals(new File(context.getFilesDir(), "shared").getCanonicalFile())) file.delete(); } catch (Exception ignored) {} }
    /** Non-exported, URI-grant-only sharing. Camera and composers never see arbitrary private files. */
    public static final class SharedContentProvider extends ContentProvider {
        @Override public boolean onCreate() { return true; }
        private File file(Uri uri) throws FileNotFoundException {
            try {
                if (uri.getPathSegments().size() != 1 || !uri.getLastPathSegment().matches("[a-f0-9-]{36}-.{1,120}")) throw new Exception("Invalid shared URI");
                File root = new File(getContext().getFilesDir(), "shared").getCanonicalFile(); File file = new File(root, uri.getLastPathSegment()).getCanonicalFile();
                if (!file.getParentFile().equals(root) || !file.isFile()) throw new Exception("Shared content does not exist"); return file;
            } catch (Exception error) { throw new FileNotFoundException(error.getMessage()); }
        }
        @Override public String getType(Uri uri) { try { String name = file(uri).getName(); String extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT); String type = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension); return type == null ? "application/octet-stream" : type; } catch (Exception ignored) { return "application/octet-stream"; } }
        @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sortOrder) {
            try { File file = file(uri); String[] columns = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection; MatrixCursor cursor = new MatrixCursor(columns); MatrixCursor.RowBuilder row = cursor.newRow();
                for (String column : columns) { if (column.equals(OpenableColumns.DISPLAY_NAME)) row.add(file.getName().substring(37)); else if (column.equals(OpenableColumns.SIZE)) row.add(file.length()); else row.add(null); } return cursor;
            } catch (Exception error) { return null; }
        }
        @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException { return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.parseMode(mode)); }
        @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Shared content is read-only except for granted camera output"); }
        @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { return 0; }
        @Override public int delete(Uri uri, String selection, String[] args) { return 0; }
    }
}
