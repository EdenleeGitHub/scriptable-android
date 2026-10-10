package dev.scriptable.android;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;

/** Android launcher equivalent of Scriptable's per-widget script/parameter configuration. */
public final class WidgetConfigureActivity extends Activity {
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        int widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        Intent result = new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId); setResult(RESULT_CANCELED, result);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return; }
        LinearLayout panel = new LinearLayout(this); panel.setOrientation(LinearLayout.VERTICAL); int pad = Math.round(24 * getResources().getDisplayMetrics().density); panel.setPadding(pad, pad * 2, pad, pad); panel.setBackgroundColor(0xFFF4F6FB); setContentView(panel);
        TextView title = new TextView(this); title.setText("配置脚本小组件"); title.setTextSize(24); title.setTextColor(0xFF202B40); panel.addView(title);
        TextView hint = new TextView(this); hint.setText("每个小组件可以选择不同脚本和参数。脚本需调用 Script.setWidget(widget)。"); hint.setPadding(0, pad, 0, pad); panel.addView(hint);
        try {
            JSONArray scripts = new ScriptRepository(this).list(); ArrayList<String> names = new ArrayList<>(); for (int i = 0; i < scripts.length(); i++) names.add(scripts.getJSONObject(i).optString("name", "Untitled"));
            if (names.isEmpty()) { hint.setText("请先在 Scriptable Android 中创建或导入脚本，再添加小组件。"); return; }
            Spinner script = new Spinner(this); script.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, names)); panel.addView(script);
            EditText parameter = new EditText(this); parameter.setHint("组件参数（args.widgetParameter）"); parameter.setSingleLine(false); panel.addView(parameter);
            String[] familyValues = {"small", "medium", "large", "extraLarge", "accessoryCircular", "accessoryRectangular", "accessoryInline"};
            Spinner family = new Spinner(this); family.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, new String[]{"小", "中", "大", "特大", "圆形（桌面替代）", "矩形（桌面替代）", "单行（桌面替代）"})); family.setSelection(1); panel.addView(family);
            for (int i = 0; i < scripts.length(); i++) if (scripts.getJSONObject(i).optString("id").equals(getSharedPreferences("widget-preview", MODE_PRIVATE).getString("script." + widgetId, ""))) script.setSelection(i);
            parameter.setText(getSharedPreferences("widget-preview", MODE_PRIVATE).getString("parameter." + widgetId, "")); String selectedFamily = getSharedPreferences("widget-preview", MODE_PRIVATE).getString("family." + widgetId, "medium"); for (int i = 0; i < familyValues.length; i++) if (selectedFamily.equals(familyValues[i])) family.setSelection(i);
            Button save = new Button(this); save.setText("添加 / 保存小组件"); panel.addView(save); save.setOnClickListener(view -> {
                try { JSONObject chosen = scripts.getJSONObject(script.getSelectedItemPosition()); ScriptWidgetProvider.configure(this, widgetId, chosen.getString("id"), parameter.getText().toString(), familyValues[family.getSelectedItemPosition()]); setResult(RESULT_OK, result); finish(); }
                catch (Exception error) { hint.setText(error.getMessage()); }
            });
        } catch (Exception error) { hint.setText("无法读取脚本：" + error.getMessage()); }
    }
}
