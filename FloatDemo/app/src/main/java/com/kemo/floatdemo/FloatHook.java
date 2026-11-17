package com.kemo.floatdemo;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

import de.robv.android.xposed.IXposedHookLoadPackage;
import de.robv.android.xposed.XC_MethodHook;
import de.robv.android.xposed.XposedBridge;
import de.robv.android.xposed.callbacks.XC_LoadPackage;

/**
 * 悬浮按钮（这一课的主角，做法和 Xcamera 的悬浮按钮一模一样）：
 *
 * 1. 盯住“页面被打开”这一刻（Activity.onResume）；
 * 2. 把一个半透明的小按钮，塞进这个页面最上层的画布（decorView）里；
 * 3. 按钮能拖着到处放；点一下，弹出一个设置面板（面板也是当场拼出来的）；
 * 4. 设置从小通道（ConfigProvider）读写，所以在面板里改、在模块页面里改，
 *    两边立刻一致，按钮每秒自己刷新一次样子，不用重开页面。
 *
 * 和 Xcamera 的区别只有两点：
 * - 它点开面板前要先联网验卡密，所以慢 1~2 秒；咱们这个不用等，点开就开；
 * - 它只贴在拍照那一个页面上；咱们这个贴在系统设置的每个页面上，
 *   图的是你翻来翻去都能看见它。真要只贴某个页面，判断一下页面名字就行。
 */
public class FloatHook implements IXposedHookLoadPackage {

    private static final String TARGET_PACKAGE = "com.android.settings"; // 系统设置
    private static final String BTN_TAG = "kemo_float_btn";
    private static final Uri CONFIG_URI =
            Uri.parse("content://com.kemo.floatdemo.config/config");

    // ---- 设置（从小通道读出来，缓存在这里）----
    private static volatile String cfgText = "设置";
    private static volatile int cfgAlpha = 55;
    private static volatile boolean cfgClock = false;
    private static volatile long lastReadAt = -10000;

    // 按钮停的位置（记住，翻页回来还在老地方）
    private static int savedLeft = -1;
    private static int savedTop = -1;

    /** 只在系统设置里干活，别的一概不碰 */
    @Override
    public void handleLoadPackage(XC_LoadPackage.LoadPackageParam lpparam) {
        if (!TARGET_PACKAGE.equals(lpparam.packageName)) {
            return;
        }
        try {
            XposedBridge.hookAllMethods(Activity.class, "onResume", new XC_MethodHook() {
                @Override
                protected void afterHookedMethod(MethodHookParam param) {
                    try {
                        if (param.thisObject instanceof Activity) {
                            inject((Activity) param.thisObject);
                        }
                    } catch (Throwable ignored) {
                        // 出任何岔子都不能把系统设置弄崩
                    }
                }
            });
        } catch (Throwable t) {
            XposedBridge.log("FloatDemo: onResume hook failed: " + t);
        }
    }

    /** 把按钮塞进页面最上层；已经有了就只刷新它的样子 */
    private void inject(final Activity act) {
        ViewGroup decor = (ViewGroup) act.getWindow().getDecorView();
        View old = decor.findViewWithTag(BTN_TAG);
        if (old instanceof TextView) {
            refreshConfig(act);
            applyAppearance(act, (TextView) old);
            return;
        }

        refreshConfig(act);
        final TextView btn = new TextView(act);
        btn.setTag(BTN_TAG);
        btn.setTextColor(Color.WHITE);
        btn.setTextSize(13);
        int padX = dp(act, 14), padY = dp(act, 8);
        btn.setPadding(padX, padY, padX, padY);

        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        if (savedLeft < 0) {
            savedLeft = act.getResources().getDisplayMetrics().widthPixels - dp(act, 120);
            savedTop = dp(act, 160);
        }
        lp.leftMargin = savedLeft;
        lp.topMargin = savedTop;
        btn.setLayoutParams(lp);
        applyAppearance(act, btn);
        makeDraggable(act, btn);
        decor.addView(btn);

        // 每秒醒一次：重读设置、刷新样子（顺便让“显示几点”跳秒）
        final Runnable[] ticker = new Runnable[1];
        ticker[0] = () -> {
            if (!btn.isAttachedToWindow()) {
                return; // 按钮已经不在了，闹钟停
            }
            try {
                refreshConfig(act);
                applyAppearance(act, btn);
            } catch (Throwable ignored) {
            }
            btn.postDelayed(ticker[0], 1000);
        };
        btn.postDelayed(ticker[0], 1000);
    }

    /** 按当前设置，给按钮换上文字和透明度 */
    private void applyAppearance(Activity act, TextView btn) {
        String want = cfgClock
                ? new SimpleDateFormat("HH:mm:ss", Locale.CHINA).format(new Date())
                : cfgText;
        if (!want.equals(btn.getText().toString())) {
            btn.setText(want);
        }
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(act, 20));
        int a = (int) (255 * cfgAlpha / 100f);
        bg.setColor(Color.argb(a, 25, 25, 25));
        btn.setBackground(bg);
    }

    /** 让按钮能拖动：按住移动是拖，轻点一下是打开面板 */
    private void makeDraggable(final Activity act, final TextView btn) {
        btn.setOnTouchListener(new View.OnTouchListener() {
            private float downRawX, downRawY;
            private int downLeft, downTop;
            private long downAt;

            @Override
            public boolean onTouch(View v, MotionEvent e) {
                FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) v.getLayoutParams();
                switch (e.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        downRawX = e.getRawX();
                        downRawY = e.getRawY();
                        downLeft = lp.leftMargin;
                        downTop = lp.topMargin;
                        downAt = SystemClock.uptimeMillis();
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        lp.leftMargin = Math.max(0, downLeft + (int) (e.getRawX() - downRawX));
                        lp.topMargin = Math.max(0, downTop + (int) (e.getRawY() - downRawY));
                        v.setLayoutParams(lp);
                        return true;
                    case MotionEvent.ACTION_UP:
                        float moved = Math.abs(e.getRawX() - downRawX)
                                + Math.abs(e.getRawY() - downRawY);
                        savedLeft = lp.leftMargin;
                        savedTop = lp.topMargin;
                        if (moved < dp(act, 10)
                                && SystemClock.uptimeMillis() - downAt < 400) {
                            openPanel(act, btn); // 没怎么动 = 点了一下
                        }
                        return true;
                    default:
                        return false;
                }
            }
        });
    }

    /** 设置面板：当场用代码拼出来（Xcamera 的设置页也是这么拼的） */
    private void openPanel(final Activity act, final TextView btn) {
        refreshConfig(act);
        LinearLayout box = new LinearLayout(act);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(act, 20);
        box.setPadding(pad, pad, pad, pad);

        TextView label1 = new TextView(act);
        label1.setText("按钮上的文字");
        box.addView(label1);
        final EditText et = new EditText(act);
        et.setText(cfgText);
        box.addView(et);

        TextView label2 = new TextView(act);
        label2.setText("透明度（左边最透，右边不透）");
        box.addView(label2);
        final SeekBar sb = new SeekBar(act);
        sb.setMax(80);
        sb.setProgress(cfgAlpha - 20);
        box.addView(sb);

        final CheckBox cb = new CheckBox(act);
        cb.setText("按钮上显示现在几点（每秒跳一下）");
        cb.setChecked(cfgClock);
        box.addView(cb);

        new AlertDialog.Builder(act)
                .setTitle("悬浮按钮设置")
                .setView(box)
                .setPositiveButton("保存", (dialog, which) -> {
                    try {
                        String text = et.getText().toString().trim();
                        if (text.isEmpty()) text = "设置";
                        ContentValues values = new ContentValues();
                        values.put(MainActivity.KEY_TEXT, text);
                        values.put(MainActivity.KEY_ALPHA, sb.getProgress() + 20);
                        values.put(MainActivity.KEY_CLOCK, cb.isChecked() ? 1 : 0);
                        // 改设置不直接写小本子，而是递给小通道——它才是小本子的主人
                        act.getContentResolver().update(CONFIG_URI, values, null, null);
                        lastReadAt = -10000; // 逼着下次重新读
                        refreshConfig(act);
                        applyAppearance(act, btn);
                        Toast.makeText(act, "保存好了，立刻生效", Toast.LENGTH_SHORT).show();
                    } catch (Throwable t) {
                        Toast.makeText(act, "保存没成功：" + t.getMessage(),
                                Toast.LENGTH_LONG).show();
                    }
                })
                .setNegativeButton("取消", null)
                .show();
    }

    /** 通过小通道读最新设置（最多每 0.8 秒读一次，省得频繁跑） */
    private void refreshConfig(Activity act) {
        long now = SystemClock.elapsedRealtime();
        if (now - lastReadAt < 800) {
            return;
        }
        lastReadAt = now;
        try {
            ContentResolver cr = act.getContentResolver();
            Cursor c = cr.query(CONFIG_URI, null, null, null, null);
            if (c != null) {
                if (c.moveToFirst()) {
                    cfgText = c.getString(0);
                    cfgAlpha = c.getInt(1);
                    cfgClock = c.getInt(2) == 1;
                }
                c.close();
            }
        } catch (Throwable ignored) {
            // 读不到就沿用上次的
        }
    }

    /** dp 转像素的小帮手（写界面尺寸时用） */
    private static int dp(Activity act, int v) {
        return (int) (v * act.getResources().getDisplayMetrics().density + 0.5f);
    }
}
