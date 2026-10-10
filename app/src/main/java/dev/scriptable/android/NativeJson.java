package dev.scriptable.android;

import org.json.JSONObject;

/** Preserves Android JSON null as an absent optional value, not the text "null". */
final class NativeJson {
    private NativeJson() {}

    static boolean hasValue(JSONObject object, String key) {
        return object != null && !object.isNull(key);
    }

    static String string(JSONObject object, String key, String fallback) {
        if (!hasValue(object, key)) return fallback;
        return object.optString(key, fallback);
    }
}
