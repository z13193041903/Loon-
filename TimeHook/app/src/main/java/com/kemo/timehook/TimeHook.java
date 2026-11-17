package com.kemo.timehook;

import android.app.AndroidAppHelper;
import android.content.ContentResolver;
import android.database.Cursor;
import android.graphics.Canvas;
import android.net.Uri;
import android.os.SystemClock;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

import de.robv.android.xposed.IXposedHookLoadPackage;
import de.robv.android.xposed.XC_MethodHook;
import de.robv.android.xposed.XposedBridge;
import de.robv.android.xposed.XposedHelpers;
import de.robv.android.xposed.callbacks.XC_LoadPackage;

/**
 * 挂钩代码（第二版，学 Xcamera 的老办法）。
 *
 * 第一版为什么不行：第一版去改今日水印相机“问现在几点”的答案，
 * 结果它内部一对表，发现时间对不上，就弹了“已为你自动校正时间”。
 *
 * Xcamera 的老办法要聪明得多：它根本不动相机的钟，
 * 只在最后一步下手——
 * 1. 相机要把时间文字写到屏幕上、印到照片上时，把文字里的
 *    日期和时间换成假的那一份（认字替换，见 rewrite）；
 * 2. 照片里藏着的防伪时间、EXIF 时间，也顺手换成假的，
 *    让照片里里外外的时间都对得上。
 * 相机的钟一直是真的，所以它怎么对表都发现不了。
 *
 * “假时间自己往前走”的算法：
 * 假时间 = 你选的时间 + 从保存那一刻起真实流逝的时长。
 * 流逝时长用手机的“开机计时器”（elapsedRealtime）来量，
 * 这个计时器跟墙上的钟无关，谁也改不动它，最稳。
 * 万一中间重启过手机（计时器归零），就退回用墙上钟的差来算。
 */
public class TimeHook implements IXposedHookLoadPackage {

    private static final String HOST_PACKAGE = "com.xhey.xcamera";
    private static final Uri CONFIG_URI =
            Uri.parse("content://com.kemo.timehook.config/config");

    // ---- 设置（从小通道读出来，缓存在这里，最多每秒重读一次）----
    private static volatile boolean cfgEnabled = false;
    private static volatile long cfgFakeStart = 0;     // 你选的时间
    private static volatile long cfgAnchorElapsed = 0; // 保存那刻的开机计时器
    private static volatile long cfgAnchorWall = 0;    // 保存那刻的真实时间
    private static volatile long lastReadAt = -10000;  // 上次读设置时的计时器值

    /** 只在今日水印相机里干活，别的一概不碰 */
    @Override
    public void handleLoadPackage(XC_LoadPackage.LoadPackageParam lpparam) {
        if (!HOST_PACKAGE.equals(lpparam.packageName)) {
            return;
        }

        // 1）文字层：凡是往界面上写字、往照片上印字的地方，都先过一遍“认字替换”
        XC_MethodHook textHook = new XC_MethodHook() {
            @Override
            protected void beforeHookedMethod(MethodHookParam param) {
                try {
                    if (!isOn()) return;
                    for (int i = 0; i < param.args.length; i++) {
                        if (param.args[i] instanceof CharSequence) {
                            String old = param.args[i].toString();
                            String now = rewrite(old);
                            if (!now.equals(old)) {
                                param.args[i] = now;
                            }
                            break; // 要写的文字永远是第一个参数，换完就走
                        }
                    }
                } catch (Throwable ignored) {
                    // 出任何岔子都放行原文，绝不能把相机弄崩
                }
            }
        };
        try {
            XposedBridge.hookAllMethods(TextView.class, "setText", textHook);
        } catch (Throwable t) {
            XposedBridge.log("TimeHook: setText hook failed: " + t);
        }
        try {
            XposedBridge.hookAllMethods(Canvas.class, "drawText", textHook);
            XposedBridge.hookAllMethods(Canvas.class, "drawTextRun", textHook);
        } catch (Throwable t) {
            XposedBridge.log("TimeHook: drawText hook failed: " + t);
        }

        // 2）照片里藏着的防伪时间：写入时换、读出时也换，双保险
        try {
            Class<?> verifyInfo = XposedHelpers.findClassIfExists(
                    "com.xhey.foundation.model.exif.WatermarkVerificationInfo",
                    lpparam.classLoader);
            if (verifyInfo != null) {
                String[] names = {
                        "setCreatedTime_aligned", "setCreatedTime_aligned_second",
                        "setCreatedTime_aligned_third",
                        "getCreatedTime_aligned", "getCreatedTime_aligned_second",
                        "getCreatedTime_aligned_third"};
                for (String name : names) {
                    try {
                        XposedBridge.hookAllMethods(verifyInfo, name, dataHook());
                    } catch (Throwable ignored) {
                    }
                }
            }
        } catch (Throwable t) {
            XposedBridge.log("TimeHook: verify info hook failed: " + t);
        }

        // 3）照片的 EXIF 时间（相册里查看照片详情时显示的拍摄时间）
        try {
            Class<?> exifComment = XposedHelpers.findClassIfExists(
                    "com.xhey.foundation.model.exif.ExifInfoUserComment",
                    lpparam.classLoader);
            if (exifComment != null) {
                String[] names = {"setCreateTime", "setDateTimeOriginal",
                        "setDateTimeDigitized", "setUserComment"};
                for (String name : names) {
                    try {
                        XposedBridge.hookAllMethods(exifComment, name, dataHook());
                    } catch (Throwable ignored) {
                    }
                }
            }
        } catch (Throwable t) {
            XposedBridge.log("TimeHook: exif hook failed: " + t);
        }
    }

    /** 防伪/EXIF 数据的替换：数字就换成假时间戳，文字就走认字替换 */
    private XC_MethodHook dataHook() {
        return new XC_MethodHook() {
            @Override
            protected void beforeHookedMethod(MethodHookParam param) {
                try {
                    if (!isOn()) return;
                    for (int i = 0; i < param.args.length; i++) {
                        Object a = param.args[i];
                        if (a instanceof Long) {
                            param.args[i] = fakeNow();
                        } else if (a instanceof String) {
                            String s = (String) a;
                            if (s.matches("\\d{13}")) {
                                param.args[i] = String.valueOf(fakeNow());
                            } else {
                                param.args[i] = rewrite(s);
                            }
                        }
                    }
                } catch (Throwable ignored) {
                }
            }

            @Override
            protected void afterHookedMethod(MethodHookParam param) {
                try {
                    if (!isOn()) return;
                    Object r = param.getResult();
                    if (r instanceof Long) {
                        param.setResult(fakeNow());
                    } else if (r instanceof String) {
                        String s = (String) r;
                        if (s.matches("\\d{13}")) {
                            param.setResult(String.valueOf(fakeNow()));
                        } else {
                            param.setResult(rewrite(s));
                        }
                    }
                } catch (Throwable ignored) {
                }
            }
        };
    }

    // ---------------- 下面是共用的小工具 ----------------

    /** 开关开着吗？顺便按需重读一次设置（最多每秒一次） */
    private boolean isOn() {
        refreshConfigIfNeeded();
        return cfgEnabled && cfgFakeStart > 0;
    }

    /** 通过小通道读设置页存的那份设置 */
    private void refreshConfigIfNeeded() {
        long now = SystemClock.elapsedRealtime();
        if (now - lastReadAt < 1000) {
            return;
        }
        lastReadAt = now;
        try {
            if (AndroidAppHelper.currentApplication() == null) return;
            ContentResolver cr = AndroidAppHelper.currentApplication()
                    .getContentResolver();
            if (cr == null) return;
            Cursor c = cr.query(CONFIG_URI, null, null, null, null);
            if (c != null) {
                if (c.moveToFirst()) {
                    cfgEnabled = c.getInt(0) == 1;
                    cfgFakeStart = c.getLong(1);
                    cfgAnchorWall = c.getLong(2);
                    // 老版本存的设置没有第 4 列，读不到就当 0（会走墙钟兜底）
                    cfgAnchorElapsed = c.getColumnCount() > 3 ? c.getLong(3) : 0;
                }
                c.close();
            }
        } catch (Throwable ignored) {
            // 读不到就沿用上次的，下一秒再试
        }
    }

    /** 现在的“假时间”：起点 + 已经真实流逝的时长 */
    static long fakeNow() {
        long elapsed = SystemClock.elapsedRealtime();
        if (cfgAnchorElapsed > 0 && elapsed >= cfgAnchorElapsed) {
            return cfgFakeStart + (elapsed - cfgAnchorElapsed);
        }
        // 重启过手机或老版本设置：用墙上钟的差兜底
        return cfgFakeStart + (System.currentTimeMillis() - cfgAnchorWall);
    }

    /**
     * 认字替换（核心）：把一段文字里“真实的今天日期 / 现在时间”
     * 换成假的那一份，格式保持原样。
     * 只认和真实时间长得一模一样的写法，所以历史照片、别的日期都不会误伤。
     */
    static String rewrite(String text) {
        if (text == null || text.length() < 4) {
            return text;
        }
        boolean hasDigit = false;
        for (int i = 0; i < text.length(); i++) {
            if (Character.isDigit(text.charAt(i))) { hasDigit = true; break; }
        }
        if (!hasDigit) {
            return text;
        }
        long real = System.currentTimeMillis();
        long fake = fakeNow();
        String out = text;
        boolean dateHit = false;

        String[] dateFormats = {
                "yyyy-MM-dd", "yyyy/MM/dd", "yyyy.MM.dd", "yyyy:MM:dd",
                "yyyy年MM月dd日", "yyyy年M月d日", "MM-dd", "MM/dd", "MM.dd"};
        for (String f : dateFormats) {
            String r = format(f, real);
            String k = format(f, fake);
            if (!r.equals(k) && out.contains(r)) {
                out = out.replace(r, k);
                dateHit = true;
            }
        }
        // 先换带秒的，再换不带秒的，顺序不能反
        String[] timeFormats = {"HH:mm:ss", "HH:mm"};
        for (String f : timeFormats) {
            String r = format(f, real);
            String k = format(f, fake);
            if (!r.equals(k) && out.contains(r)) {
                out = out.replace(r, k);
            }
        }
        // 日期换了，星期几也要跟着换（比如“2026.11.18 星期三”）
        if (dateHit) {
            String[] week = {"日", "一", "二", "三", "四", "五", "六"};
            String realWeek = "星期" + week[dayOfWeek(real)];
            String fakeWeek = "星期" + week[dayOfWeek(fake)];
            if (!realWeek.equals(fakeWeek) && out.contains(realWeek)) {
                out = out.replace(realWeek, fakeWeek);
            }
        }
        return out;
    }

    private static String format(String pattern, long millis) {
        return new SimpleDateFormat(pattern, Locale.CHINA).format(new Date(millis));
    }

    /** 星期几：返回 0=星期日 … 6=星期六 */
    private static int dayOfWeek(long millis) {
        Calendar c = Calendar.getInstance(Locale.CHINA);
        c.setTimeInMillis(millis);
        return c.get(Calendar.DAY_OF_WEEK) - 1;
    }
}
