package com.kemo.timehook;

import android.app.AndroidAppHelper;
import android.app.Application;
import android.database.Cursor;
import android.net.Uri;
import android.os.SystemClock;

import de.robv.android.xposed.IXposedHookLoadPackage;
import de.robv.android.xposed.XC_MethodHook;
import de.robv.android.xposed.XposedHelpers;
import de.robv.android.xposed.callbacks.XC_LoadPackage;

/**
 * 挂钩代码：真正干活的部分，跑在今日水印相机的程序里面。
 *
 * 它只做一件事：盯住“现在几点”这个最源头的问题（System.currentTimeMillis）。
 * 今日水印相机每次想知道现在几点，都会来问这一句；我们把答案换掉，
 * 它拿到的就是假时间。
 *
 * 为什么只盯这一句就够了：
 * 日历（Calendar）、日期（Date）、新式时间（java.time）这些，
 * 它们自己其实也是转头来问这一句才知道时间的。所以源头换掉，
 * 它们全都会跟着变，不用一个个去改——一个个改反而会改重，
 * 把时间换错两次。
 *
 * 假时间怎么算：
 * 假时间 = 你选的时间 +（真实时间 − 保存那一刻的真实时间）
 * 也就是：从你点保存那一刻起，它的时间就从你选的点开始，
 * 一秒一秒按真实速度往前走。
 *
 * 设置从哪来：通过 ConfigProvider 那个小通道读，
 * 最多每 30 秒重新读一次，所以你在设置页改了之后，
 * 它不用重启、过一小会儿也会跟上。
 *
 * 没动的东西：计时用的秒表类时间（elapsedRealtime）不碰，
 * 不然动画、倒计时这些靠它算间隔的功能会乱。
 * 另外，如果今日水印相机在最底层用别的方式取时间（比如跟服务器对时间），
 * 那个不在这一句的管辖范围里，改不到——它水印上显示的时间走的是这一句。
 */
public class TimeHook implements IXposedHookLoadPackage {

    // 只对今日水印相机生效，其他 App 一律不碰
    private static final String TARGET_PACKAGE = "com.xhey.xcamera";
    // 配置小通道的地址，和模块户口本里登记的要一致
    private static final Uri CONFIG_URI = Uri.parse("content://com.kemo.timehook.config/config");

    private volatile boolean enabled = false;   // 开关
    private volatile long fakeStart = 0;        // 你选的时间（起点）
    private volatile long anchorReal = 0;       // 保存那一刻的真实时间
    private volatile long lastReadElapsed = -40000; // 上次读设置是什么时候（开机计时）

    @Override
    public void handleLoadPackage(XC_LoadPackage.LoadPackageParam lpparam) {
        // 不是今日水印相机，直接走人
        if (!TARGET_PACKAGE.equals(lpparam.packageName)) {
            return;
        }

        // 盯住源头那一句：System.currentTimeMillis()
        XposedHelpers.findAndHookMethod(System.class, "currentTimeMillis",
                new XC_MethodHook() {
                    @Override
                    protected void afterHookedMethod(MethodHookParam param) {
                        refreshConfigIfNeeded();
                        if (!isActive()) {
                            return; // 没开开关，就让它拿真实时间
                        }
                        long realNow = (Long) param.getResult(); // 它本来要拿到的真实时间
                        param.setResult(fakeNow(realNow));        // 换成假时间递给它
                    }
                });
    }

    /** 开关开着、设置也齐全，才算数 */
    private boolean isActive() {
        return enabled && fakeStart > 0 && anchorReal > 0;
    }

    /** 假时间 = 起点 + 已经真实过去的时长 */
    private long fakeNow(long realNow) {
        return fakeStart + (realNow - anchorReal);
    }

    /** 最多每 30 秒去小通道重新读一次设置 */
    private void refreshConfigIfNeeded() {
        long elapsed = SystemClock.elapsedRealtime();
        if (elapsed - lastReadElapsed < 30000) {
            return;
        }
        try {
            Application app = AndroidAppHelper.currentApplication();
            if (app == null) {
                // 程序还没完全起来，过 5 秒再试
                lastReadElapsed = elapsed - 25000;
                return;
            }
            Cursor cursor = app.getContentResolver()
                    .query(CONFIG_URI, null, null, null, null);
            if (cursor != null) {
                if (cursor.moveToFirst()) {
                    enabled = cursor.getInt(0) == 1;
                    fakeStart = cursor.getLong(1);
                    anchorReal = cursor.getLong(2);
                }
                cursor.close();
            }
            lastReadElapsed = elapsed;
        } catch (Throwable ignored) {
            // 读不到就先用上次的设置，过一会儿再试
            lastReadElapsed = elapsed - 25000;
        }
    }
}
