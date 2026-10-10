package dev.scriptable.android;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** Independent Apache-licensed Material Design Icons glyph renderer. */
public final class NativeSymbols {
    private static JSONObject mdi;
    private static JSONArray names;
    private static Typeface face;
    private NativeSymbols() {}
    private static String read(Context context, String asset) throws Exception {
        try (InputStream input = context.getAssets().open(asset); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) >= 0) { output.write(buffer, 0, count); if (output.size() > 1024 * 1024) throw new Exception("Symbol metadata exceeds 1 MiB"); }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }
    private static synchronized void initialize(Context context) throws Exception {
        if (mdi == null) mdi = new JSONObject(read(context, "icons/mdi-map.json"));
        if (names == null) names = new JSONArray(read(context, "icons/sf-symbol-names.json"));
        if (face == null) face = Typeface.createFromAsset(context.getAssets(), "icons/mdi.ttf");
    }
    public static Object handle(Context context, String action, JSONObject payload) throws Exception {
        initialize(context.getApplicationContext());
        if (action.equals("symbols.catalog")) return new JSONObject().put("mdi", mdi).put("sf", names).put("mdiVersion", "7.4.47").put("sfNamesVersion", "2.2.0");
        if (!action.equals("symbols.render")) throw new Exception("Unknown symbol action");
        String name = payload.getString("mdiName"); if (!mdi.has(name)) throw new Exception("Unknown Android icon: " + name);
        double requested = payload.optDouble("size", 24); if (!Double.isFinite(requested) || requested <= 0 || requested > 1024) throw new Exception("Symbol size must be between 0 and 1024");
        int size = Math.max(1, (int)Math.ceil(requested)), weight = 400;
        String configured = payload.optString("weight", "400");
        try { weight = Integer.parseInt(configured); } catch (NumberFormatException ignored) { if (configured.equals("bold")) weight = 700; }
        weight = Math.max(100, Math.min(900, weight));
        boolean circle = payload.optBoolean("circle"), square = payload.optBoolean("square");
        String badge = payload.optString("badge", "");
        if (!badge.matches("(?:|null|dot|plus|minus|checkmark|xmark|exclamationmark|questionmark)")) throw new Exception("Invalid symbol badge");
        String literal = payload.optString("textValue", "");
        if (literal.equals("null")) literal = "";
        if (!literal.isEmpty() && !literal.matches("(?:[0-9]{1,2}|[a-z])")) throw new Exception("Invalid literal symbol");
        String glyph = literal.isEmpty() ? new String(Character.toChars(mdi.getInt(name))) : literal;
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        try {
            Canvas canvas = new Canvas(bitmap); Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG); paint.setColor(Color.BLACK); paint.setTypeface(literal.isEmpty() ? face : Typeface.DEFAULT);
            boolean wrapped = circle || square;
            boolean shapeFilled = wrapped && payload.optBoolean("shapeFilled");
            if (shapeFilled) { if (circle) canvas.drawCircle(size / 2f, size / 2f, size * .44f, paint); else canvas.drawRoundRect(new RectF(size * .06f, size * .06f, size * .94f, size * .94f), size * .14f, size * .14f, paint); paint.setColor(Color.WHITE); }
            paint.setTextSize(size * (literal.isEmpty() ? wrapped ? .68f : .94f : .49f));
            Rect bounds = new Rect(); paint.getTextBounds(glyph, 0, glyph.length(), bounds);
            float x = (size - bounds.width()) / 2f - bounds.left, y = (size - bounds.height()) / 2f - bounds.top;
            canvas.drawText(glyph, x, y, paint);
            if (weight != 400) {
                paint.setStyle(Paint.Style.STROKE); paint.setStrokeJoin(Paint.Join.ROUND);
                paint.setStrokeWidth(size * Math.abs(weight - 400) / 400f * .012f);
                if (weight < 400) { if (shapeFilled) paint.setColor(Color.BLACK); else paint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.CLEAR)); }
                canvas.drawText(glyph, x, y, paint); paint.setXfermode(null);
            }
            paint.setTypeface(Typeface.DEFAULT); paint.setColor(Color.BLACK); paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(Math.max(.5f, size * .065f));
            float inset = size * .06f;
            if (circle) canvas.drawCircle(size / 2f, size / 2f, size * .44f, paint);
            else if (square) canvas.drawRoundRect(new RectF(inset, inset, size - inset, size - inset), size * .14f, size * .14f, paint);
            if (!badge.isEmpty() && !badge.equals("null")) badge(canvas, paint, badge, size);
            ByteArrayOutputStream output = new ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
            if (output.size() > 8 * 1024 * 1024) throw new Exception("Rendered icon exceeds 8 MiB");
            return new JSONObject().put("base64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)).put("mimeType", "image/png").put("width", size).put("height", size);
        } finally { bitmap.recycle(); }
    }
    private static void badge(Canvas canvas, Paint paint, String type, int size) {
        float cx = size * .78f, cy = size * .78f, r = size * .21f;
        paint.setStyle(Paint.Style.FILL); paint.setColor(Color.WHITE); canvas.drawCircle(cx, cy, r + size * .025f, paint);
        paint.setColor(Color.BLACK); canvas.drawCircle(cx, cy, r, paint);
        if (type.equals("dot")) return;
        paint.setColor(Color.WHITE); paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(Math.max(.5f, size * .045f)); paint.setStrokeCap(Paint.Cap.ROUND);
        float d = r * .5f;
        if (type.equals("plus") || type.equals("minus")) { canvas.drawLine(cx - d, cy, cx + d, cy, paint); if (type.equals("plus")) canvas.drawLine(cx, cy - d, cx, cy + d, paint); }
        else if (type.equals("xmark")) { canvas.drawLine(cx - d, cy - d, cx + d, cy + d, paint); canvas.drawLine(cx - d, cy + d, cx + d, cy - d, paint); }
        else if (type.equals("checkmark")) { canvas.drawLine(cx - d, cy, cx - d / 4, cy + d / 2, paint); canvas.drawLine(cx - d / 4, cy + d / 2, cx + d, cy - d / 2, paint); }
        else { paint.setStyle(Paint.Style.FILL); paint.setTextSize(r * 1.6f); paint.setTextAlign(Paint.Align.CENTER); canvas.drawText(type.equals("questionmark") ? "?" : "!", cx, cy + r * .55f, paint); }
    }
}
