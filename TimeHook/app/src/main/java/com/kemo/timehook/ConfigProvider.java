package com.kemo.timehook;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;

/**
 * 配置小通道。
 *
 * 为什么需要它：设置页是“模块自己”在写设置，而真正要用这份设置的，
 * 是跑在今日水印相机里面的挂钩代码——两边是两个不同的程序，
 * 各自的小本子互相看不见（这正是很多模块“改了设置不生效”的原因）。
 *
 * 所以这里开一个小窗口：谁来问，就把小本子里的三样东西递出去：
 * 开关开没开、你选的时间、保存那一刻的真实时间。
 * 今日水印相机那边的挂钩代码就是通过这个窗口读设置的。
 */
public class ConfigProvider extends ContentProvider {

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        SharedPreferences sp = getContext().getSharedPreferences(
                MainActivity.PREFS, Context.MODE_PRIVATE);
        // 把四样东西排成一行表格递出去，顺序固定：开关、起点、墙钟锚点、计时器锚点
        MatrixCursor cursor = new MatrixCursor(
                new String[]{"enabled", "fake_start", "anchor_real", "anchor_elapsed"});
        cursor.addRow(new Object[]{
                sp.getBoolean(MainActivity.KEY_ENABLED, false) ? 1 : 0,
                sp.getLong(MainActivity.KEY_FAKE_START, 0),
                sp.getLong(MainActivity.KEY_ANCHOR_REAL, 0),
                sp.getLong(MainActivity.KEY_ANCHOR_ELAPSED, 0)
        });
        return cursor;
    }

    // 下面几个用不上，只是格式要求必须写上
    @Override
    public String getType(Uri uri) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
