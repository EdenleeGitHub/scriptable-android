package dev.scriptable.android;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.text.TextUtils;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.DateFormat;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** Canvas widget layout shared by launcher snapshots, including stacks, images, gradients and date styles. */
final class WidgetRenderer {
    static final class Hit {
        final RectF rectangle; final String url;
        Hit(RectF rectangle, String url) { this.rectangle = rectangle; this.url = url; }
    }
    static final class Result {
        final Bitmap bitmap; final List<Hit> hits; final List<DynamicDate> dynamicDates;
        Result(Bitmap bitmap, List<Hit> hits, List<DynamicDate> dynamicDates) { this.bitmap = bitmap; this.hits = hits; this.dynamicDates = dynamicDates; }
        String urlAt(float x, float y) { for (int i = hits.size() - 1; i >= 0; i--) if (hits.get(i).rectangle.contains(x, y)) return hits.get(i).url; return null; }
    }
    static final class DynamicDate {
        final RectF rectangle; final long dateEpoch; final float fontSize; final int textColor; final String alignment;
        DynamicDate(RectF rectangle, long dateEpoch, TextPaint paint, String alignment) { this.rectangle = rectangle; this.dateEpoch = dateEpoch; this.fontSize = paint.getTextSize(); this.textColor = paint.getColor(); this.alignment = alignment; }
    }
    private static final class Box {
        final JSONObject node; final ArrayList<Box> children = new ArrayList<>();
        float width, height;
        Box(JSONObject node) { this.node = node; }
    }
    private final Canvas canvas;
    private final ArrayList<Hit> hits = new ArrayList<>();
    private final ArrayList<DynamicDate> dynamicDates = new ArrayList<>();
    private final float scale;
    private int nodeCount;
    private WidgetRenderer(Canvas canvas, float scale) { this.canvas = canvas; this.scale = scale; }

    static Result render(JSONObject tree, int widthDp, int heightDp, float requestedScale) {
        int w = Math.max(64, Math.min(900, widthDp)), h = Math.max(48, Math.min(900, heightDp));
        float scale = Math.max(.5f, Math.min(2f, requestedScale));
        if (w * h * scale * scale > 250000) scale = (float) Math.sqrt(250000.0 / (w * h));
        Bitmap bitmap = Bitmap.createBitmap(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap); canvas.scale(scale, scale);
        WidgetRenderer renderer = new WidgetRenderer(canvas, scale);
        Box box = renderer.measure(tree, w, h, 0); renderer.draw(box, 0, 0, w, h, 0);
        return new Result(bitmap, renderer.hits, renderer.dynamicDates);
    }
    static int color(String value, int fallback) {
        try { if (value.matches("#[0-9a-fA-F]{8}")) value = "#" + value.substring(7, 9) + value.substring(1, 7); return android.graphics.Color.parseColor(value); } catch (Exception error) { return fallback; }
    }
    static Paint imagePaint(JSONObject node) {
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        paint.setAlpha(Math.round(255 * Math.max(0, Math.min(1, number(node, "imageOpacity", 1)))));
        if (NativeJson.hasValue(node,"tintColor")) paint.setColorFilter(new android.graphics.PorterDuffColorFilter(color(node.optString("tintColor"), android.graphics.Color.WHITE), android.graphics.PorterDuff.Mode.SRC_IN));
        return paint;
    }
    static Typeface typeface(JSONObject font) {
        String name = font == null ? "sans-serif" : font.optString("family", font.optString("name", "sans-serif"));
        String weight = font == null ? "normal" : font.optString("weight", "normal");
        int style = "bold".equals(weight) || font != null && font.optDouble("weight", 0) >= 600 ? Typeface.BOLD : Typeface.NORMAL;
        if (font != null && "italic".equals(font.optString("style"))) style |= Typeface.ITALIC;
        if (name.contains("Mono") || name.toLowerCase(Locale.ROOT).contains("monospace")) name = "monospace";
        if (name.contains("System") || name.startsWith("SF")) name = "sans-serif";
        return Typeface.create(name, style);
    }
    static Bitmap decodeImage(String value) {
        try {
            if (value == null || !value.startsWith("data:image/")) return null;
            int comma = value.indexOf(','); if (comma < 0 || value.length() > 6 * 1024 * 1024) return null;
            byte[] bytes = Base64.decode(value.substring(comma + 1), Base64.DEFAULT);
            BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
            if (options.outWidth <= 0 || options.outHeight <= 0 || (long) options.outWidth * options.outHeight > 64000000) return null;
            options.inSampleSize = 1; while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 1024) options.inSampleSize *= 2;
            options.inJustDecodeBounds = false; return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        } catch (Exception error) { return null; }
    }
    private static float number(JSONObject node, String key, float fallback) { double value = node.optDouble(key, fallback); return Double.isFinite(value) ? (float) Math.max(-10000, Math.min(10000, value)) : fallback; }
    private float[] padding(JSONObject node) {
        JSONArray list = node.optJSONArray("padding"); float[] result = new float[]{0, 0, 0, 0};
        if (list != null) for (int i = 0; i < Math.min(4, list.length()); i++) result[i] = (float) Math.max(0, Math.min(1000, list.optDouble(i, 0)));
        else if ("widget".equals(node.optString("type"))) result = new float[]{16, 16, 16, 16};
        return result;
    }
    private Box measure(JSONObject node, float maxWidth, float maxHeight, int depth) {
        Box box = new Box(node); if (++nodeCount > 1000 || depth > 30) return box;
        String type = node.optString("type");
        JSONObject size = node.optJSONObject("size");
        float explicitWidth = size == null ? 0 : number(size, "width", 0), explicitHeight = size == null ? 0 : number(size, "height", 0);
        if (explicitWidth > 0) maxWidth = Math.min(maxWidth, explicitWidth); if (explicitHeight > 0) maxHeight = Math.min(maxHeight, explicitHeight);
        if ("spacer".equals(type)) { box.width = box.height = Math.max(0, number(node, "length", 0)); return box; }
        if ("text".equals(type) || "date".equals(type)) {
            TextPaint paint = textPaint(node); String text = content(node);
            box.width = Math.min(maxWidth, Math.max(1, desiredWidth(text, paint)));
            StaticLayout layout = textLayout(node, text, paint, Math.max(1, Math.round(maxWidth)), Math.round(maxHeight)); box.height = layout.getHeight();
            return box;
        }
        if ("image".equals(type)) {
            JSONObject imageSize = node.optJSONObject("imageSize"); Bitmap bitmap = decodeImage(node.optString("image"));
            float width = imageSize == null ? bitmap == null ? 32 : bitmap.getWidth() / scale : number(imageSize, "width", 32);
            float height = imageSize == null ? bitmap == null ? 32 : bitmap.getHeight() / scale : number(imageSize, "height", 32);
            float fit = Math.min(1, Math.min(maxWidth / Math.max(1, width), maxHeight / Math.max(1, height))); box.width = width * fit; box.height = height * fit;
            return box;
        }
        float[] pad = padding(node); float contentWidth = Math.max(0, maxWidth - pad[1] - pad[3]), contentHeight = Math.max(0, maxHeight - pad[0] - pad[2]);
        boolean horizontal = "horizontal".equals(node.optString("layout")); JSONArray children = node.optJSONArray("children"); float main = 0, cross = 0, spacing = Math.max(0, number(node, "spacing", 0));
        if (children != null) for (int i = 0; i < Math.min(200, children.length()); i++) {
            JSONObject child = children.optJSONObject(i); if (child == null) continue;
            Box childBox = measure(child, contentWidth, contentHeight, depth + 1); box.children.add(childBox);
            main += horizontal ? childBox.width : childBox.height; cross = Math.max(cross, horizontal ? childBox.height : childBox.width);
        }
        main += Math.max(0, box.children.size() - 1) * spacing;
        box.width = explicitWidth > 0 ? Math.min(explicitWidth, maxWidth) : Math.min(maxWidth, (horizontal ? main : cross) + pad[1] + pad[3]);
        box.height = explicitHeight > 0 ? Math.min(explicitHeight, maxHeight) : Math.min(maxHeight, (horizontal ? cross : main) + pad[0] + pad[2]);
        return box;
    }
    private float desiredWidth(String text, TextPaint paint) { float width = 0; for (String line : text.split("\n", -1)) width = Math.max(width, paint.measureText(line)); return width; }
    private TextPaint textPaint(JSONObject node) {
        TextPaint paint = new TextPaint(Paint.ANTI_ALIAS_FLAG); JSONObject font = node.optJSONObject("font");
        paint.setTypeface(typeface(font)); paint.setTextSize(font == null ? 15 : Math.max(1, Math.min(256, number(font, "size", 15))));
        paint.setColor(color(NativeJson.string(node,"textColor", NativeJson.string(node,"color", "#FFFFFF")), android.graphics.Color.WHITE));
        paint.setAlpha(Math.round(android.graphics.Color.alpha(paint.getColor()) * Math.max(0, Math.min(1, number(node, "textOpacity", 1)))));
        if (NativeJson.hasValue(node,"shadowColor")) { JSONObject offset = node.optJSONObject("shadowOffset"); paint.setShadowLayer(Math.max(.01f, number(node, "shadowRadius", 0)), offset == null ? 0 : number(offset, "width", number(offset, "x", 0)), offset == null ? 0 : number(offset, "height", number(offset, "y", 0)), color(node.optString("shadowColor"), android.graphics.Color.TRANSPARENT)); }
        return paint;
    }
    private StaticLayout textLayout(JSONObject node, String text, TextPaint paint, int width, int height) {
        int limit = Math.max(0, node.optInt("lineLimit", 0));
        Layout.Alignment alignment = "center".equals(node.optString("alignment")) ? Layout.Alignment.ALIGN_CENTER : "right".equals(node.optString("alignment")) ? Layout.Alignment.ALIGN_OPPOSITE : Layout.Alignment.ALIGN_NORMAL;
        StaticLayout.Builder builder = StaticLayout.Builder.obtain(text, 0, text.length(), paint, Math.max(1, width)).setAlignment(alignment).setIncludePad(false).setBreakStrategy(android.graphics.text.LineBreaker.BREAK_STRATEGY_HIGH_QUALITY);
        if (limit > 0) builder.setMaxLines(limit).setEllipsize(TextUtils.TruncateAt.END);
        StaticLayout layout = builder.build();
        float original = paint.getTextSize(), minimum = Math.max(0, Math.min(1, number(node, "minimumScaleFactor", 1)));
        if (minimum < 1 && (height > 0 && layout.getHeight() > height || limit == 1 && desiredWidth(text, paint) > width)) {
            float factor = Math.min(height > 0 ? (float) height / Math.max(1, layout.getHeight()) : 1, limit == 1 ? width / Math.max(1, desiredWidth(text, paint)) : 1); paint.setTextSize(original * Math.max(minimum, factor));
            builder = StaticLayout.Builder.obtain(text, 0, text.length(), paint, Math.max(1, width)).setAlignment(alignment).setIncludePad(false); if (limit > 0) builder.setMaxLines(limit).setEllipsize(TextUtils.TruncateAt.END); layout = builder.build();
        }
        return layout;
    }
    private String content(JSONObject node) {
        if (!"date".equals(node.optString("type"))) return node.optString("text", "");
        try {
            long timestamp = Instant.parse(node.getString("date")).toEpochMilli(); Date date = new Date(timestamp); String style = node.optString("dateStyle", "date");
            if ("time".equals(style)) return DateFormat.getTimeInstance(DateFormat.SHORT).format(date);
            if ("date".equals(style)) return DateFormat.getDateInstance(DateFormat.MEDIUM).format(date);
            long delta = timestamp - System.currentTimeMillis(), seconds = Math.abs(delta) / 1000;
            if ("timer".equals(style)) return seconds >= 3600 ? String.format(Locale.getDefault(), "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60) : String.format(Locale.getDefault(), "%d:%02d", seconds / 60, seconds % 60);
            long value = seconds < 60 ? seconds : seconds < 3600 ? seconds / 60 : seconds < 86400 ? seconds / 3600 : seconds / 86400;
            String unit = seconds < 60 ? "s" : seconds < 3600 ? "min" : seconds < 86400 ? "h" : "d";
            if ("offset".equals(style)) return (delta < 0 ? "−" : "+") + value + " " + unit;
            return delta < 0 ? value + " " + unit + " ago" : "in " + value + " " + unit;
        } catch (Exception ignored) { return node.optString("text", ""); }
    }
    private void draw(Box box, float x, float y, float width, float height, int depth) {
        if (depth > 30 || width <= 0 || height <= 0) return;
        JSONObject node = box.node; String type = node.optString("type");
        RectF rectangle = new RectF(x, y, x + width, y + height);
        String url=NativeJson.string(node,"url", "");
        if (!url.isEmpty()) hits.add(new Hit(rectangle, url));
        canvas.save();
        float corner = Math.max(0, number(node, "cornerRadius", "image".equals(type) ? number(node, "imageCornerRadius", 0) : 0));
        Path clip = new Path(); clip.addRoundRect(rectangle, corner, corner, Path.Direction.CW); canvas.clipPath(clip);
        background(node, rectangle, corner);
        if ("text".equals(type) || "date".equals(type)) {
            TextPaint paint = textPaint(node); StaticLayout layout = textLayout(node, content(node), paint, Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
            boolean live = false;
            if ("date".equals(type) && "timer".equals(node.optString("dateStyle"))) try {
                long date = Instant.parse(node.getString("date")).toEpochMilli(); RectF visible = new RectF(rectangle);
                if (visible.intersect(new RectF(canvas.getClipBounds()))) { dynamicDates.add(new DynamicDate(visible, date, paint, node.optString("alignment", "left"))); live = true; }
            } catch (Exception ignored) { }
            if (!live) { canvas.translate(x, y); layout.draw(canvas); }
        }
        else if ("image".equals(type)) {
            Bitmap bitmap = decodeImage(node.optString("image")); if (bitmap != null) {
                Paint paint = imagePaint(node);
                image(bitmap, rectangle, "fill".equals(node.optString("contentMode")), paint);
            }
        } else if (!"spacer".equals(type)) children(box, x, y, width, height, depth);
        canvas.restore();
        float border = Math.max(0, number(node, "borderWidth", "image".equals(type) ? number(node, "imageBorderWidth", 0) : 0));
        if (border > 0) { Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG); paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(border); paint.setColor(color(node.optString("borderColor", node.optString("imageBorderColor", "#FFFFFF")), android.graphics.Color.WHITE)); RectF inset = new RectF(rectangle); inset.inset(border / 2, border / 2); canvas.drawRoundRect(inset, corner, corner, paint); }
    }
    private void children(Box box, float x, float y, float width, float height, int depth) {
        JSONObject node = box.node; float[] pad = padding(node); x += pad[1]; y += pad[0]; width = Math.max(0, width - pad[1] - pad[3]); height = Math.max(0, height - pad[0] - pad[2]);
        boolean horizontal = "horizontal".equals(node.optString("layout")); float spacing = Math.max(0, number(node, "spacing", 0)); float main = 0; int flex = 0;
        for (Box child : box.children) { if ("spacer".equals(child.node.optString("type")) && !child.node.has("length")) flex++; else main += horizontal ? child.width : child.height; }
        main += Math.max(0, box.children.size() - 1) * spacing; float available = horizontal ? width : height;
        float extra = flex == 0 ? 0 : Math.max(0, available - main) / flex;
        float shrink = main > available && main > 0 ? Math.max(0, (available - spacing * Math.max(0, box.children.size() - 1)) / Math.max(1, main - spacing * Math.max(0, box.children.size() - 1))) : 1;
        float offset = 0;
        for (Box child : box.children) {
            boolean spacer = "spacer".equals(child.node.optString("type"));
            float length = spacer && !child.node.has("length") ? extra : (horizontal ? child.width : child.height) * shrink;
            if (horizontal) {
                float cross = Math.min(height, child.height); String align = node.optString("alignment"); float dy = "bottom".equals(align) ? height - cross : "center".equals(align) ? (height - cross) / 2 : 0;
                // Remeasure wrapped text after assigning its final horizontal width.
                if ("text".equals(child.node.optString("type")) || "date".equals(child.node.optString("type"))) { cross = Math.min(height, textLayout(child.node, content(child.node), textPaint(child.node), Math.max(1, Math.round(length)), Math.round(height)).getHeight()); dy = "bottom".equals(align) ? height - cross : "center".equals(align) ? (height - cross) / 2 : 0; }
                draw(child, x + offset, y + dy, length, spacer ? height : cross, depth + 1);
            } else {
                float cross = "text".equals(child.node.optString("type")) || "date".equals(child.node.optString("type")) ? width : Math.min(width, child.width);
                String align = child.node.optString("alignment"); float dx = "right".equals(align) ? width - cross : "center".equals(align) ? (width - cross) / 2 : 0;
                draw(child, x + dx, y + offset, spacer ? width : cross, length, depth + 1);
            }
            offset += length + spacing;
        }
    }
    private void background(JSONObject node, RectF rect, float corner) {
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG); boolean fill = NativeJson.hasValue(node,"backgroundColor"); paint.setColor(color(NativeJson.string(node,"backgroundColor", ""), android.graphics.Color.TRANSPARENT));
        JSONObject gradient = node.optJSONObject("backgroundGradient");
        if (gradient != null) try {
            JSONArray list = gradient.getJSONArray("colors"), locations = gradient.optJSONArray("locations");
            if (list.length() >= 2 && list.length() <= 64) {
                int[] colors = new int[list.length()]; float[] stops = new float[list.length()];
                for (int i = 0; i < list.length(); i++) { colors[i] = color(list.getString(i), android.graphics.Color.TRANSPARENT); stops[i] = locations == null ? (float) i / (list.length() - 1) : (float) locations.optDouble(i, (double) i / (list.length() - 1)); }
                JSONObject start = gradient.optJSONObject("startPoint"), end = gradient.optJSONObject("endPoint");
                paint.setShader(new android.graphics.LinearGradient(rect.left + rect.width() * (start == null ? 0 : number(start, "x", 0)), rect.top + rect.height() * (start == null ? 0 : number(start, "y", 0)), rect.left + rect.width() * (end == null ? 1 : number(end, "x", 1)), rect.top + rect.height() * (end == null ? 1 : number(end, "y", 1)), colors, stops, Shader.TileMode.CLAMP)); fill = true;
            } else if (list.length() == 1) { paint.setColor(color(list.getString(0), android.graphics.Color.TRANSPARENT)); fill = true; }
        } catch (Exception ignored) { }
        if (fill) canvas.drawRoundRect(rect, corner, corner, paint);
        Bitmap background = decodeImage(node.optString("backgroundImage")); if (background != null) image(background, rect, true, new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG));
    }
    private void image(Bitmap bitmap, RectF target, boolean fill, Paint paint) {
        float scale = fill ? Math.max(target.width() / bitmap.getWidth(), target.height() / bitmap.getHeight()) : Math.min(target.width() / bitmap.getWidth(), target.height() / bitmap.getHeight());
        float w = bitmap.getWidth() * scale, h = bitmap.getHeight() * scale;
        RectF destination = new RectF(target.centerX() - w / 2, target.centerY() - h / 2, target.centerX() + w / 2, target.centerY() + h / 2); canvas.drawBitmap(bitmap, null, destination, paint);
    }
}
