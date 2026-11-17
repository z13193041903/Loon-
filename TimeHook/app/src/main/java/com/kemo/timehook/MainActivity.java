package com.kemo.timehook;

import android.app.Activity;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.widget.Button;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/**
 * 设置页：你打开这个模块时看到的页面。
 *
 * 你在这里做的事只有三件：
 * 1. 打开/关闭「开启改时间」开关
 * 2. 选一个日期和时间（比如 2026-11-01 08:30）
 * 3. 点保存
 *
 * 保存的那一刻，模块会记下两样东西：
 * - 你选的时间（假时间的起点）
 * - 保存这一刻的真实时间（用来算“过了多久”）
 * 之后今日水印相机那边就按：假时间 = 起点 + 已经过去的真实时长，自己往前走。
 *
 * 设置存在这个小本子里（SharedPreferences），再由 ConfigProvider 这个
 * “小通道”递给今日水印相机那边读——这样两边看的是同一份设置，
 * 不会出现“这边改了、那边还是旧的”的毛病。
 */
public class MainActivity extends Activity {

    // 小本子的名字和每一项的钥匙（ConfigProvider 也用同一套，要改一起改）
    public static final String PREFS = "time_config";
    public static final String KEY_ENABLED = "enabled";       // 开关：开没开
    public static final String KEY_FAKE_START = "fake_start"; // 你选的时间（起点）
    public static final String KEY_ANCHOR_REAL = "anchor_real"; // 保存那一刻的真实时间

    private Switch switchEnabled;
    private TextView tvChosen;
    private long chosenMillis = 0; // 你选好的时间，0 表示还没选

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        switchEnabled = findViewById(R.id.switch_enabled);
        tvChosen = findViewById(R.id.tv_chosen);
        Button btnPick = findViewById(R.id.btn_pick);
        Button btnSave = findViewById(R.id.btn_save);

        // 打开页面时，先把上次存的设置读出来显示
        SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        switchEnabled.setChecked(sp.getBoolean(KEY_ENABLED, false));
        chosenMillis = sp.getLong(KEY_FAKE_START, 0);
        updateLabel();

        // 点「选日期和时间」：先弹日历，选完再弹时钟
        btnPick.setOnClickListener(v -> pickDateTime());

        // 点「保存」：把开关、你选的时间、还有“现在这一刻的真实时间”一起存好
        btnSave.setOnClickListener(v -> {
            if (chosenMillis == 0) {
                Toast.makeText(this, "先选一个日期和时间", Toast.LENGTH_SHORT).show();
                return;
            }
            getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean(KEY_ENABLED, switchEnabled.isChecked())
                    .putLong(KEY_FAKE_START, chosenMillis)
                    .putLong(KEY_ANCHOR_REAL, System.currentTimeMillis()) // 锚点：从这一刻开始算
                    .apply();
            Toast.makeText(this,
                    "已保存。把今日水印相机彻底关掉再打开，就能看到新时间了",
                    Toast.LENGTH_LONG).show();
        });
    }

    /** 先选日期、再选几点几分，选好后更新页面上的文字 */
    private void pickDateTime() {
        Calendar cal = Calendar.getInstance();
        if (chosenMillis > 0) {
            cal.setTimeInMillis(chosenMillis); // 之前选过，就从上次的时间接着选
        }
        new DatePickerDialog(this, (view, year, month, day) -> {
            Calendar picked = Calendar.getInstance();
            picked.set(year, month, day, 0, 0, 0);
            new TimePickerDialog(this, (timeView, hour, minute) -> {
                picked.set(Calendar.HOUR_OF_DAY, hour);
                picked.set(Calendar.MINUTE, minute);
                picked.set(Calendar.SECOND, 0);
                chosenMillis = picked.getTimeInMillis();
                updateLabel();
            }, cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE), true).show();
        }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show();
    }

    /** 把选好的时间显示成“2026-11-01 08:30”这样的文字 */
    private void updateLabel() {
        if (chosenMillis == 0) {
            tvChosen.setText("还没选时间");
        } else {
            String text = new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.CHINA)
                    .format(new Date(chosenMillis));
            tvChosen.setText("已选时间：" + text);
        }
    }
}
