package com.kemo.floatdemo;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;

/**
 * 配置小通道（这次是双向的：能读也能写）。
 *
 * 为什么需要它：设置存在模块自己的小本子里，
 * 但悬浮按钮跑在“系统设置”的程序里面，两边互相看不见对方的小本子
 * （Xcamera 当年“改了设置不生效”就是栽在这）。
 *
 * 所以开一个小窗口，两边都走它：
 * - 谁要看设置，来这里问（query）；
 * - 谁要改设置，来这里递条子（update），由模块这边落进小本子。
 * 这样不管在哪边改，另一边读到的永远是最新的一份。
 */
public class ConfigProvider extends ContentProvider {

    @Override
    public boolean onCreate() {
        return true;
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(
                MainActivity.PREFS, Context.MODE_PRIVATE);
    }

    /** 读：把三样设置排成一行递出去：文字、透明度、显示时间开关 */
    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        SharedPreferences sp = prefs();
        MatrixCursor cursor = new MatrixCursor(
                new String[]{"btn_text", "alpha_pct", "show_clock"});
        cursor.addRow(new Object[]{
                sp.getString(MainActivity.KEY_TEXT, "设置"),
                sp.getInt(MainActivity.KEY_ALPHA, 55),
                sp.getBoolean(MainActivity.KEY_CLOCK, false) ? 1 : 0
        });
        return cursor;
    }

    /** 写：悬浮按钮那边的设置面板改完设置，就从这里递进来 */
    @Override
    public int update(Uri uri, ContentValues values, String selection,
                      String[] selectionArgs) {
        SharedPreferences.Editor e = prefs().edit();
        if (values.containsKey(MainActivity.KEY_TEXT)) {
            e.putString(MainActivity.KEY_TEXT, values.getAsString(MainActivity.KEY_TEXT));
        }
        if (values.containsKey(MainActivity.KEY_ALPHA)) {
            e.putInt(MainActivity.KEY_ALPHA, values.getAsInteger(MainActivity.KEY_ALPHA));
        }
        if (values.containsKey(MainActivity.KEY_CLOCK)) {
            e.putBoolean(MainActivity.KEY_CLOCK, values.getAsInteger(MainActivity.KEY_CLOCK) == 1);
        }
        e.apply();
        return 1;
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
}
