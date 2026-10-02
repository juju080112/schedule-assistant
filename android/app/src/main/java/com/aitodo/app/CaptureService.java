package com.aitodo.app;

import android.app.Notification;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * v1.9.0 采集版：指定应用（默认 QQ）的通知采集 —— 只做「抓下来、看得见、能核对字段」，
 * 不做任何判断、不调用 AI、不生成日程。
 *
 * 设计边界（有意为之）：
 *  - 只用系统公开的通知监听能力，不碰目标应用本体（不 hook、不注入、不读它的数据库）；
 *  - 数据只写本机 SharedPreferences（aitodo_capture），不发网络、不进 WebView 的 localStorage
 *    —— v1.8.20 的教训：原生写不了 WebView 存储，方向必须是「原生存、网页层读」；
 *  - 采集范围由「通知使用权」+ 本包名单共同限定，用户在设置页可关可清。
 *
 * 拿不到什么（写在这里免得后来人误判为 bug）：
 *  - 目标应用自己没弹通知的东西（例如该会话被设为免打扰），监听根本收不到；
 *  - 授权之前的历史；正在目标应用内查看的会话（不会弹通知）；
 *  - 图片/文件/语音消息的通知通常只有「[图片]」这类占位文字。
 */
public class CaptureService extends NotificationListenerService {

    static final String PREFS = "aitodo_capture";
    static final String KEY_ENABLED = "enabled";
    static final String KEY_ITEMS = "items";
    static final String KEY_PKGS = "pkgs";

    private static final String TAG = "AiTodoCapture";
    /** 默认采集对象：手机 QQ、QQ 轻龄版、TIM */
    private static final String[] DEFAULT_PKGS = {
            "com.tencent.mobileqq", "com.tencent.mobileqq.lite", "com.tencent.tim"
    };
    private static final int MAX_ITEMS = 150;
    private static final int KEEP_FIELDS = 40;      /* 只有最近 40 条保留完整字段 dump */
    private static final long MAX_AGE = 7L * 86400000L;
    private static final int MAX_TEXT = 2000;
    private static final int MAX_DUMP = 1200;

    private static volatile CaptureService instance;

    /* ---------------- 对外静态口（插件与网页层用） ---------------- */

    public static boolean permissionGranted(Context ctx) {
        try {
            String cur = Settings.Secure.getString(
                    ctx.getContentResolver(), "enabled_notification_listeners");
            return cur != null && cur.contains(ctx.getPackageName());
        } catch (Throwable t) {
            return false;
        }
    }

    public static boolean serviceConnected() {
        return instance != null;
    }

    public static boolean enabled(Context ctx) {
        return prefs(ctx).getBoolean(KEY_ENABLED, true);
    }

    public static void setEnabled(Context ctx, boolean on) {
        prefs(ctx).edit().putBoolean(KEY_ENABLED, on).apply();
    }

    public static String packageList(Context ctx) {
        String s = prefs(ctx).getString(KEY_PKGS, null);
        if (s == null || s.trim().isEmpty()) {
            StringBuilder sb = new StringBuilder();
            for (String p : DEFAULT_PKGS) {
                if (sb.length() > 0) sb.append(',');
                sb.append(p);
            }
            return sb.toString();
        }
        return s;
    }

    /** 读已采集条目（新的在前）。limit<=0 表示全部。 */
    public static String itemsJson(Context ctx, int limit) {
        String raw = prefs(ctx).getString(KEY_ITEMS, "");
        if (raw == null || raw.isEmpty()) return "[]";
        if (limit <= 0) return raw;
        try {
            JSONArray src = new JSONArray(raw);
            JSONArray out = new JSONArray();
            for (int i = 0; i < src.length() && i < limit; i++) out.put(src.get(i));
            return out.toString();
        } catch (Throwable t) {
            return raw;
        }
    }

    public static int itemCount(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString(KEY_ITEMS, "[]")).length();
        } catch (Throwable t) {
            return 0;
        }
    }

    public static void clearItems(Context ctx) {
        prefs(ctx).edit().remove(KEY_ITEMS).apply();
    }

    /** 主动回捞当前还挂在通知栏里的目标应用通知（授权之前的历史仍然拿不到）。 */
    public static int rescanNow(Context ctx) {
        CaptureService s = instance;
        if (s == null) return -1;
        return s.drainActive("bar");
    }

    /* ---------------- NotificationListenerService 回调 ---------------- */

    @Override
    public void onListenerConnected() {
        instance = this;
        Log.d(TAG, "监听已连接");
        drainActive("bar");
        CapturePlugin.requestWake();
    }

    @Override
    public void onListenerDisconnected() {
        instance = null;
        Log.d(TAG, "监听已断开（系统会按授权状态自动重连）");
    }

    @Override
    public void onNotificationPosted(final StatusBarNotification sbn) {
        try {
            if (sbn == null) return;
            if (!enabled(this)) return;
            if (!wanted(sbn.getPackageName())) return;
            JSONObject item = build(sbn, "push");
            if (item == null) return;
            append(item);
            CapturePlugin.requestWake();
        } catch (Throwable t) {
            Log.d(TAG, "采集异常: " + t);
        }
    }

    /* ---------------- 内部实现 ---------------- */

    private SharedPreferences prefs() {
        return prefs(this);
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private boolean wanted(String pkg) {
        if (pkg == null) return false;
        String self = getPackageName();
        if (pkg.equals(self)) return false;           /* 自己发的通知不采 */
        for (String p : packageList(this).split(",")) {
            if (pkg.equals(p.trim())) return true;
        }
        return false;
    }

    private int drainActive(String from) {
        int n = 0;
        try {
            StatusBarNotification[] all = getActiveNotifications();
            if (all == null) return 0;
            for (StatusBarNotification sbn : all) {
                try {
                    if (sbn == null || !wanted(sbn.getPackageName())) continue;
                    JSONObject item = build(sbn, from);
                    if (item == null) continue;
                    if (append(item)) n++;
                } catch (Throwable ignored) {
                }
            }
        } catch (Throwable t) {
            Log.d(TAG, "回捞失败: " + t);
        }
        return n;
    }

    /** 把一条通知摊平成可核对的条目；正文全空的（服务类通知）返回 null 不入库。 */
    private JSONObject build(StatusBarNotification sbn, String from) {
        Notification n = sbn.getNotification();
        if (n == null) return null;
        Bundle ex = n.extras;
        String title = cs(ex, Notification.EXTRA_TITLE);
        String sub = cs(ex, Notification.EXTRA_SUB_TEXT);
        String text = cs(ex, Notification.EXTRA_TEXT);
        String big = cs(ex, Notification.EXTRA_BIG_TEXT);
        String lines = lineArray(ex);

        String body = firstNotEmpty(text, big, lines, sub);
        if (isEmpty(title) && isEmpty(body)) return null;

        try {
            JSONObject o = new JSONObject();
            String core = nz(title) + "\u0001" + nz(sub) + "\u0001" + nz(text) + "\u0001" + nz(big) + "\u0001" + nz(lines);
            o.put("id", sbn.getPackageName() + "|" + sbn.getKey() + "|" + Integer.toHexString(core.hashCode()));
            o.put("pkg", sbn.getPackageName());
            o.put("app", appLabel(sbn.getPackageName()));
            o.put("title", cut(title, MAX_TEXT));
            o.put("sub", cut(sub, 300));
            o.put("text", cut(text, MAX_TEXT));
            o.put("big", cut(big, MAX_TEXT));
            o.put("lines", cut(lines, MAX_TEXT));
            o.put("time", sbn.getPostTime() > 0 ? sbn.getPostTime() : System.currentTimeMillis());
            o.put("when", n.when);
            o.put("from", from);
            o.put("fields", dump(ex));
            return o;
        } catch (Throwable t) {
            return null;
        }
    }

    /** 追加进队列并做去重、裁剪（只保留最近 MAX_ITEMS 条 / MAX_AGE 毫秒）。 */
    private boolean append(JSONObject item) {
        SharedPreferences p = prefs();
        JSONArray arr;
        try {
            arr = new JSONArray(p.getString(KEY_ITEMS, "[]"));
        } catch (Throwable t) {
            arr = new JSONArray();
        }
        String id = item.optString("id");
        for (int i = 0; i < arr.length(); i++) {
            try {
                if (id.equals(arr.getJSONObject(i).optString("id"))) return false;   /* 同一条更新过的通知不重复入库 */
            } catch (Throwable ignored) {
            }
        }
        JSONArray out = new JSONArray();
        out.put(item);
        long floor = System.currentTimeMillis() - MAX_AGE;
        for (int i = 0; i < arr.length() && out.length() < MAX_ITEMS; i++) {
            try {
                JSONObject old = arr.getJSONObject(i);
                if (old.optLong("time", 0) < floor) continue;
                if (out.length() >= KEEP_FIELDS) old.remove("fields");  /* 老的条目不再留字段 dump，控制体积 */
                out.put(old);
            } catch (Throwable ignored) {
            }
        }
        p.edit().putString(KEY_ITEMS, out.toString()).apply();
        return true;
    }

    private String appLabel(String pkg) {
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            CharSequence s = pm.getApplicationLabel(ai);
            return s == null ? pkg : s.toString();
        } catch (Throwable t) {
            return pkg;
        }
    }

    private static String cs(Bundle ex, String key) {
        if (ex == null) return "";
        try {
            Object o = ex.get(key);
            return o == null ? "" : String.valueOf(o);
        } catch (Throwable t) {
            return "";
        }
    }

    /** EXTRA_TEXT_LINES 在不同版本/厂商上是 String[] 或 CharSequence[]，两种都吃。 */
    private static String lineArray(Bundle ex) {
        if (ex == null) return "";
        try {
            Object o = ex.get(Notification.EXTRA_TEXT_LINES);
            if (o == null) return "";
            List<String> list = new ArrayList<String>();
            if (o instanceof String[]) {
                for (String s : (String[]) o) list.add(s);
            } else if (o instanceof CharSequence[]) {
                for (CharSequence s : (CharSequence[]) o) list.add(s == null ? "" : s.toString());
            } else {
                return String.valueOf(o);
            }
            StringBuilder sb = new StringBuilder();
            for (String s : list) {
                if (s == null || s.isEmpty()) continue;
                if (sb.length() > 0) sb.append('\n');
                sb.append(s);
                if (sb.length() > MAX_TEXT) break;
            }
            return sb.toString();
        } catch (Throwable t) {
            return "";
        }
    }

    /** 完整 extras 字段导出：采集版的核心用途就是拿真机通知核对「到底能拿到什么」。 */
    private static String dump(Bundle ex) {
        if (ex == null) return "";
        StringBuilder sb = new StringBuilder();
        int i = 0;
        try {
            for (String k : ex.keySet()) {
                if (i++ >= 80 || sb.length() > MAX_DUMP) break;
                Object v;
                try {
                    v = ex.get(k);
                } catch (Throwable t) {
                    continue;
                }
                if (v == null) continue;
                String vs;
                if (v instanceof byte[]) vs = "<bytes " + ((byte[]) v).length + ">";
                else if (v instanceof Object[]) vs = "<" + v.getClass().getSimpleName() + " x" + ((Object[]) v).length + ">";
                else vs = String.valueOf(v);
                vs = vs.replace('\n', ' ');
                if (vs.length() > 160) vs = vs.substring(0, 160) + "…";
                sb.append(k).append('=').append(vs).append('\n');
            }
        } catch (Throwable t) {
            /* 某些 ROM 上未 parcel 的 Bundle 会抛异常，已有字段照常保留 */
        }
        return cut(sb.toString(), MAX_DUMP);
    }

    private static boolean isEmpty(String s) {
        return s == null || s.trim().isEmpty();
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    private static String firstNotEmpty(String... xs) {
        for (String x : xs) if (!isEmpty(x)) return x;
        return "";
    }

    private static String cut(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max);
    }
}
