package com.kemo.floatdemo;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.Toast;

/**
 * 设置页：你在桌面点开这个模块时看到的页面。
 *
 * 它和系统设置里那个悬浮按钮的设置面板，改的是同一份设置：
 * 这边保存，那边最多过一秒就跟着变——靠的就是 ConfigProvider 那个小通道。
 */
public class MainActivity extends Activity {

    // 小本子的名字和每一项的钥匙（ConfigProvider、FloatHook 也用同一套，要改一起改）
    public static final String PREFS = "float_config";
    public static final String KEY_TEXT = "btn_text";   // 按钮上的文字
    public static final String KEY_ALPHA = "alpha_pct"; // 透明度：20（最透）~100（不透）
    public static final String KEY_CLOCK = "show_clock";// 按钮上显示现在几点

    private EditText etText;
    private SeekBar sbAlpha;
    private Switch swClock;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        etText = findViewById(R.id.et_text);
        sbAlpha = findViewById(R.id.sb_alpha);
        swClock = findViewById(R.id.sw_clock);
        Button btnSave = findViewById(R.id.btn_save);

        // 打开页面时，先把上次存的设置读出来显示
        SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        etText.setText(sp.getString(KEY_TEXT, "设置"));
        sbAlpha.setProgress(sp.getInt(KEY_ALPHA, 55) - 20); // 滑杆从 0 开始，存的是 20~100
        swClock.setChecked(sp.getBoolean(KEY_CLOCK, false));

        btnSave.setOnClickListener(v -> {
            String text = etText.getText().toString().trim();
            if (text.isEmpty()) {
                text = "设置";
            }
            getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(KEY_TEXT, text)
                    .putInt(KEY_ALPHA, sbAlpha.getProgress() + 20)
                    .putBoolean(KEY_CLOCK, swClock.isChecked())
                    .apply();
            Toast.makeText(this,
                    "保存好了。去打开系统设置，看看按钮变了没有",
                    Toast.LENGTH_LONG).show();
        });
    }
}
