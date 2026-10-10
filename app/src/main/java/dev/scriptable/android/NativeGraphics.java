package dev.scriptable.android;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.text.ParsePosition;
import java.util.Date;
import android.icu.text.DateFormat;
import android.icu.text.SimpleDateFormat;
import android.icu.util.TimeZone;
import android.icu.util.ULocale;

/** Bounded, synchronous bitmap rendering for the script Worker endpoint. */
public final class NativeGraphics {
    private static final int MAX_SIDE = 2048, MAX_PIXELS = 4 * 1024 * 1024;
    private static final int MAX_BYTES = 8 * 1024 * 1024, MAX_COMMANDS = 10000;
    private NativeGraphics() {}

    public static Object handle(String action, JSONObject payload) throws Exception {
        switch (action) {
            case "date.format": {
                DateFormat format = dateFormat(payload);
                return format == null ? "" : format.format(new Date(payload.getLong("timestamp")));
            }
            case "date.parse": {
                DateFormat format = dateFormat(payload);
                if (format == null) return JSONObject.NULL;
                String value = payload.getString("value");
                if (value.length() > 32768) throw new IllegalArgumentException("Date text is too long.");
                ParsePosition position = new ParsePosition(0);
                Date date = format.parse(value, position);
                return date != null && position.getIndex() == value.length() ? date.getTime() : JSONObject.NULL;
            }
            case "graphics.render": return render(payload);
            case "graphics.symbol": {
                // Runtime provides original semantic vector equivalents. This
                // avoids shipping Apple's licensed SF Symbols assets.
                if (!payload.has("commands")) throw new IllegalArgumentException("Unknown Android symbol recipe: " + payload.optString("name"));
                JSONObject recipe = new JSONObject(payload.toString());
                recipe.put("width", 24).put("height", 24).put("scale", scalar(payload, "fontSize", 24) / 24.0).put("opaque", false);
                return render(recipe);
            }
            case "image.info": {
                byte[] bytes = bytes(payload.getString("base64"));
                BitmapFactory.Options info = dimensions(bytes);
                Bitmap verified = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                if (verified == null) throw new IllegalArgumentException("Invalid or unsupported image data.");
                verified.recycle();
                return new JSONObject().put("width", info.outWidth).put("height", info.outHeight).put("mimeType", info.outMimeType == null ? "image/png" : info.outMimeType);
            }
            case "image.convert": {
                Bitmap source = decode(payload.getString("base64")), output = source;
                boolean jpeg = payload.optString("format", "png").equals("jpeg");
                double quality = scalar(payload, "quality", .9);
                if (quality < 0 || quality > 1) { source.recycle(); throw new IllegalArgumentException("Image quality must be between 0 and 1."); }
                try {
                    if (jpeg) { output = Bitmap.createBitmap(source.getWidth(), source.getHeight(), Bitmap.Config.ARGB_8888); Canvas canvas = new Canvas(output); canvas.drawColor(Color.WHITE); canvas.drawBitmap(source, 0, 0, new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG)); }
                    return encode(output, jpeg, quality);
                } finally { if (output != source) output.recycle(); source.recycle(); }
            }
            default: throw new IllegalArgumentException("Unsupported graphics action: " + action);
        }
    }

    private static int dateStyle(String value) {
        switch (value) { case "short": return DateFormat.SHORT; case "medium": return DateFormat.MEDIUM; case "long": return DateFormat.LONG; case "full": return DateFormat.FULL; default: return -1; }
    }
    private static DateFormat dateFormat(JSONObject payload) {
        ULocale locale = ULocale.forLanguageTag(payload.optString("locale", "en-US").replace('_', '-'));
        String pattern = payload.optString("dateFormat", "");
        if (pattern.length() > 1024) throw new IllegalArgumentException("Date format exceeds 1024 characters.");
        DateFormat format;
        if (!pattern.isEmpty()) format = new SimpleDateFormat(pattern, locale);
        else {
            int date = dateStyle(payload.optString("dateStyle", "")), time = dateStyle(payload.optString("timeStyle", ""));
            if (date < 0 && time < 0) return null;
            format = date < 0 ? DateFormat.getTimeInstance(time, locale) : time < 0 ? DateFormat.getDateInstance(date, locale) : DateFormat.getDateTimeInstance(date, time, locale);
        }
        format.setLenient(false);
        String zone = payload.optString("timeZone", "");
        if (!zone.isEmpty() && !zone.equals("null")) format.setTimeZone(TimeZone.getTimeZone(zone));
        return format;
    }

    private static void checkDimensions(double width, double height) {
        if (!Double.isFinite(width) || !Double.isFinite(height) || width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) throw new IllegalArgumentException("Images must be 1-2048 pixels per dimension and at most 4 megapixels.");
    }
    private static byte[] bytes(String base64) {
        if (base64.length() > ((long)MAX_BYTES * 4 / 3 + 16)) throw new IllegalArgumentException("Image exceeds 8 MiB.");
        byte[] bytes;
        try { bytes = Base64.decode(base64, Base64.DEFAULT); } catch (IllegalArgumentException error) { throw new IllegalArgumentException("Invalid image base64."); }
        if (bytes.length > MAX_BYTES) throw new IllegalArgumentException("Image exceeds 8 MiB.");
        return bytes;
    }
    private static BitmapFactory.Options dimensions(byte[] bytes) {
        BitmapFactory.Options info = new BitmapFactory.Options(); info.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, info);
        checkDimensions(info.outWidth, info.outHeight); return info;
    }
    private static Bitmap decode(String base64) {
        byte[] bytes = bytes(base64); dimensions(bytes);
        BitmapFactory.Options options = new BitmapFactory.Options(); options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (bitmap == null) throw new IllegalArgumentException("Invalid or unsupported image data.");
        return bitmap;
    }
    private static JSONObject encode(Bitmap bitmap, boolean jpeg, double quality) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        if (!bitmap.compress(jpeg ? Bitmap.CompressFormat.JPEG : Bitmap.CompressFormat.PNG, jpeg ? (int)Math.round(quality * 100) : 100, output)) throw new IllegalArgumentException("Image encoding failed.");
        if (output.size() > MAX_BYTES) throw new IllegalArgumentException("Encoded image exceeds 8 MiB.");
        return new JSONObject().put("base64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)).put("mimeType", jpeg ? "image/jpeg" : "image/png").put("width", bitmap.getWidth()).put("height", bitmap.getHeight());
    }
    private static double scalar(JSONObject object, String key, double fallback) {
        double value = object.optDouble(key, fallback);
        if (!Double.isFinite(value) || Math.abs(value) > 1000000) throw new IllegalArgumentException("Invalid drawing value: " + key);
        return value;
    }
    private static float n(JSONObject object, String key) { return (float)scalar(object, key, 0); }
    private static RectF rectangle(JSONObject r) { return new RectF(n(r, "x"), n(r, "y"), n(r, "x") + n(r, "width"), n(r, "y") + n(r, "height")); }
    private static int rgba(String value) {
        if (!value.matches("#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?")) throw new IllegalArgumentException("Invalid drawing color.");
        long rgb = Long.parseLong(value.substring(1, 7), 16); int alpha = value.length() == 9 ? Integer.parseInt(value.substring(7, 9), 16) : 255;
        return (alpha << 24) | (int)rgb;
    }
    private static Path path(JSONArray segments) throws Exception {
        if (segments.length() > MAX_COMMANDS) throw new IllegalArgumentException("Path exceeds 10000 segments.");
        Path path = new Path();
        for (int i = 0; i < segments.length(); i++) {
            JSONObject segment = segments.getJSONObject(i);
            switch (segment.getString("op")) {
                case "move": path.moveTo(n(segment, "x"), n(segment, "y")); break;
                case "line": path.lineTo(n(segment, "x"), n(segment, "y")); break;
                case "curve": { JSONObject a = segment.getJSONObject("c1"), b = segment.getJSONObject("c2"); path.cubicTo(n(a, "x"), n(a, "y"), n(b, "x"), n(b, "y"), n(segment, "x"), n(segment, "y")); break; }
                case "quad": { JSONObject a = segment.getJSONObject("c"); path.quadTo(n(a, "x"), n(a, "y"), n(segment, "x"), n(segment, "y")); break; }
                case "rect": path.addRect(rectangle(segment), Path.Direction.CCW); break;
                case "ellipse": path.addOval(rectangle(segment), Path.Direction.CCW); break;
                case "roundRect": { RectF rect = rectangle(segment); path.addRoundRect(rect, Math.max(0, Math.min(n(segment, "rx"), rect.width() / 2)), Math.max(0, Math.min(n(segment, "ry"), rect.height() / 2)), Path.Direction.CCW); break; }
                case "close": path.close(); break;
                default: throw new IllegalArgumentException("Invalid path operation.");
            }
        }
        return path;
    }
    private static void text(Canvas canvas, JSONObject command) throws Exception {
        String text = command.optString("text");
        if (text.length() > 32768) throw new IllegalArgumentException("Drawn text exceeds 32768 characters.");
        JSONObject font = command.getJSONObject("font"); float size = n(font, "size");
        if (size <= 0 || size > 1024) throw new IllegalArgumentException("Invalid font size.");
        String weight = font.optString("weight", "normal"), family = font.optString("family", "sans-serif");
        int numericWeight; try { numericWeight = Integer.parseInt(weight); } catch (NumberFormatException ignored) { numericWeight = weight.equals("bold") ? 700 : 400; }
        int style = font.optString("style").equals("italic") ? (numericWeight>=600?Typeface.BOLD_ITALIC:Typeface.ITALIC) : (numericWeight>=600?Typeface.BOLD:Typeface.NORMAL);
        TextPaint paint = new TextPaint(Paint.ANTI_ALIAS_FLAG); paint.setColor(rgba(command.optString("color", "#000000ff"))); paint.setTextSize(size); paint.setTypeface(Typeface.create(family, style));
        if (android.os.Build.VERSION.SDK_INT >= 28) paint.setTypeface(Typeface.create(Typeface.create(family, Typeface.NORMAL), Math.max(1, Math.min(numericWeight, 1000)), (style & Typeface.ITALIC) != 0));
        JSONObject bounds = command.optJSONObject("rect"); boolean bounded = bounds != null;
        if (!bounded) bounds = command.getJSONObject("point");
        float x = n(bounds, "x"), y = n(bounds, "y"), height = bounded ? n(bounds, "height") : 1000000;
        float width = bounded ? n(bounds, "width") : 1;
        if (!bounded) for (String line : text.split("\n", -1)) width = Math.max(width, paint.measureText(line));
        if (width <= 0 || height <= 0) return;
        width = Math.min(1000000, width);
        String alignment = command.optString("alignment", "left");
        Layout.Alignment align = alignment.equals("center") ? Layout.Alignment.ALIGN_CENTER : alignment.equals("right") ? Layout.Alignment.ALIGN_OPPOSITE : Layout.Alignment.ALIGN_NORMAL;
        StaticLayout layout = StaticLayout.Builder.obtain(text, 0, text.length(), paint, Math.max(1, (int)Math.ceil(width))).setAlignment(align).setIncludePad(false).setBreakStrategy(android.graphics.text.LineBreaker.BREAK_STRATEGY_SIMPLE).build();
        canvas.save(); if (bounded) canvas.clipRect(x, y, x + width, y + height); canvas.translate(x, y); layout.draw(canvas); canvas.restore();
    }
    private static JSONObject render(JSONObject payload) throws Exception {
        if (payload.toString().length() > 12 * 1024 * 1024) throw new IllegalArgumentException("Drawing recipe exceeds 12 MiB.");
        double width = scalar(payload, "width", 0), height = scalar(payload, "height", 0), scale = scalar(payload, "scale", 1);
        if (width <= 0 || height <= 0 || scale <= 0 || scale > 256) throw new IllegalArgumentException("Drawing size and scale must be positive.");
        double scaledWidth = Math.ceil(width * scale), scaledHeight = Math.ceil(height * scale);
        checkDimensions(scaledWidth, scaledHeight);
        JSONArray commands = payload.getJSONArray("commands");
        if (commands.length() > MAX_COMMANDS) throw new IllegalArgumentException("Drawing exceeds 10000 operations.");
        Bitmap bitmap = Bitmap.createBitmap((int)scaledWidth, (int)scaledHeight, Bitmap.Config.ARGB_8888);
        try {
            Canvas canvas = new Canvas(bitmap); if (payload.optBoolean("opaque", true)) canvas.drawColor(Color.BLACK);
            canvas.scale((float)scale, (float)scale); Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG); paint.setStrokeCap(Paint.Cap.ROUND); paint.setStrokeJoin(Paint.Join.ROUND);
            for (int i = 0; i < commands.length(); i++) {
                JSONObject command = commands.getJSONObject(i); String op = command.getString("op");
                paint.setColor(rgba(command.optString("color", "#000000ff"))); float lineWidth = (float)scalar(command, "lineWidth", 1);
                if (lineWidth < 0 || lineWidth > 1024) throw new IllegalArgumentException("Invalid line width.");
                paint.setStrokeWidth(lineWidth); paint.setStyle(op.startsWith("stroke") ? Paint.Style.STROKE : Paint.Style.FILL);
                canvas.save(); JSONObject transform = command.optJSONObject("transform");
                if (transform != null) { canvas.translate(n(transform, "x"), n(transform, "y")); float s = (float)scalar(transform, "scale", 1); if (s <= 0 || s > 256) throw new IllegalArgumentException("Invalid drawing transform."); canvas.scale(s, s); }
                switch (op) {
                    case "fillRect": case "strokeRect": canvas.drawRect(rectangle(command.getJSONObject("rect")), paint); break;
                    case "fillEllipse": case "strokeEllipse": canvas.drawOval(rectangle(command.getJSONObject("rect")), paint); break;
                    case "fillPath": case "strokePath": canvas.drawPath(path(command.getJSONArray("path")), paint); break;
                    case "text": text(canvas, command); break;
                    case "image": { Bitmap image = decode(command.getString("base64")); try { paint.setAlpha(255); canvas.drawBitmap(image, null, rectangle(command.getJSONObject("rect")), paint); } finally { image.recycle(); } break; }
                    default: throw new IllegalArgumentException("Invalid drawing operation: " + op);
                }
                canvas.restore();
            }
            // Transparent strokes on an opaque context must still encode an
            // opaque output. Canvas initially uses an opaque black backing.
            return encode(bitmap, false, 1);
        } finally { bitmap.recycle(); }
    }
}
