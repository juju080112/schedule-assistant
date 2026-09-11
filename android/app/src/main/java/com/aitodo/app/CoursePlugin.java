package com.aitodo.app;

import android.app.Activity;
import android.content.Intent;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebStorage;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 网页层 ↔ 教务课表同步 的桥（v1.7.0）
 *
 * 合规设计：本插件只负责「打开登录窗口」「回传抓取结果」「排程课程提醒」。
 * 账号密码由用户在窗口内亲手输入，插件不接触、不读取、不存储任何凭据。
 *
 * 结果回传采用「静态待处理调用 + MainActivity.onActivityResult 转发」，
 * 不依赖 Capacitor 的 saved-call 调度（部分厂商 ROM 在活动覆盖期间
 * 重建桥/恢复栈时会丢失回调，导致网页层 promise 永远挂起）。
 *
 * 方法：
 *   openLogin({url})              打开教务登录窗口，resolve 带回抓取报告（raw）与抓取页地址（url）
 *   syncAlarms({state})           网页层推送课表状态，原生重排「当天+3天」课程提醒
 *   setAuto({enabled}) / getAuto  每日自动同步开关
 *   clearLogin()                  清除本机保存的登录会话（Cookie 与站点存储）
 */
@CapacitorPlugin(name = "CourseSync")
public class CoursePlugin extends Plugin {

    public static final int REQ_LOGIN = 7421;
    private static final String TAG = "CourseSync";

    /** 待回传的登录窗口调用（进程内静态，跨 Activity 生命周期可靠） */
    private static PluginCall pendingLogin;

    /** 打开教务登录窗口。resolve 时带回抓取结果 JSON 与抓取页地址 */
    @PluginMethod
    public void openLogin(PluginCall call) {
        PluginCall old = pendingLogin;
        pendingLogin = null;
        if (old != null) {
            JSObject r = new JSObject();
            r.put("ok", false);
            r.put("error", "cancelled");
            r.put("raw", "");
            safeResolve(old, r);
        }
        Activity act = getActivity();
        if (act == null) {
            call.reject("Activity 不可用");
            return;
        }
        pendingLogin = call;
        String url = call.getString("url");
        Intent i = new Intent(act, CourseLoginActivity.class);
        if (url != null && !url.trim().isEmpty()) {
            i.putExtra(CourseLoginActivity.EXTRA_URL, url.trim());
        }
        Log.d(TAG, "openLogin: 启动登录窗口");
        act.startActivityForResult(i, REQ_LOGIN);
    }

    /** 由 MainActivity.onActivityResult 转发进来（v1.7.1：静态回传，不经 Capacitor 调度） */
    public static void onLoginResult(int resultCode, Intent data) {
        PluginCall c = pendingLogin;
        pendingLogin = null;
        Log.d(TAG, "onLoginResult: resultCode=" + resultCode
                + (data != null ? " hasExtra=" + data.hasExtra(CourseLoginActivity.EXTRA_RESULT) : " data=null"));
        if (c == null) return;
        JSObject ret = new JSObject();
        String payload = data != null ? data.getStringExtra(CourseLoginActivity.EXTRA_RESULT) : null;
        String grabUrl = data != null ? data.getStringExtra(CourseLoginActivity.EXTRA_GRAB_URL) : null;
        if (payload == null || payload.isEmpty()) {
            ret.put("ok", false);
            ret.put("error", "cancelled");
            ret.put("raw", "");
        } else {
            ret.put("ok", true);
            ret.put("raw", payload);
            if (grabUrl != null && !grabUrl.isEmpty()) ret.put("url", grabUrl);
            Log.d(TAG, "onLoginResult: payload=" + payload.length() + " chars, url=" + grabUrl);
        }
        safeResolve(c, ret);
    }

    private static void safeResolve(PluginCall c, JSObject ret) {
        try {
            c.resolve(ret);
        } catch (Throwable t) {
            Log.w(TAG, "resolve 失败（网页层可能已刷新）: " + t.getMessage());
        }
    }

    /** 网页层推送完整课表状态，原生据此重排课程提醒（准点 + 提前1小时，窗口=当天+3天） */
    @PluginMethod
    public void syncAlarms(PluginCall call) {
        String state = call.getString("state", "{}");
        CourseAutoSync.applyState(getContext(), state);
        call.resolve();
    }

    @PluginMethod
    public void setAuto(PluginCall call) {
        Boolean on = call.getBoolean("enabled", true);
        CourseAutoSync.setAuto(getContext(), on != null && on);
        call.resolve();
    }

    @PluginMethod
    public void getAuto(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("enabled", CourseAutoSync.isAuto(getContext()));
        call.resolve(ret);
    }

    /**
     * v1.8.14：把原生保存的课表状态回流给网页层。
     * 每天 06:30 的后台同步只写原生状态（网页层拿不到），网页层启动/回前台时调用本方法，
     * 若原生结果比网页层新，就采纳它并据此更新日程（课表临时调整也能自动生效）。
     */
    @PluginMethod
    public void getState(PluginCall call) {
        try {
            org.json.JSONObject st = CourseAutoSync.loadState(getContext());
            JSObject ret = new JSObject();
            ret.put("state", st.toString());
            ret.put("syncedAt", st.optLong("syncedAt", 0L));
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("state", "");
            ret.put("syncedAt", 0L);
            call.resolve(ret);
        }
    }

    /** 读取最近一次抓取的原始报告（course_raw.json），供 Intent 通道异常时的兜底 */
    @PluginMethod
    public void getCourseRaw(PluginCall call) {
        JSObject ret = new JSObject();
        String raw = "";
        try {
            java.io.File f = new java.io.File(getContext().getFilesDir(), CourseLoginActivity.RAW_FILE);
            if (f.exists()) {
                byte[] buf = new byte[(int) Math.min(f.length(), 2_000_000L)];
                try (java.io.FileInputStream fi = new java.io.FileInputStream(f)) {
                    int n = fi.read(buf);
                    if (n > 0) raw = new String(buf, 0, n, "UTF-8");
                }
            }
        } catch (Exception ignored) {}
        ret.put("raw", raw);
        call.resolve(ret);
    }

    /** 清除本机登录会话（「清除本地课表数据」时调用） */
    @PluginMethod
    public void clearLogin(PluginCall call) {
        try {
            CookieManager cm = CookieManager.getInstance();
            cm.removeAllCookies(null);
            cm.flush();
        } catch (Exception ignored) {}
        try {
            WebStorage.getInstance().deleteAllData();
        } catch (Exception ignored) {}
        call.resolve();
    }
}
