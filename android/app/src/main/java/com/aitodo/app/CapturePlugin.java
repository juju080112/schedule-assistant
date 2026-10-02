package com.aitodo.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * v1.9.0 采集版：网页层 ↔ 通知采集服务 的桥。
 *
 * 方向约定（v1.8.20 的教训）：采集数据只存在原生 SharedPreferences，
 * 网页层通过本插件「读」，原生绝不试图写 WebView 的 localStorage。
 *
 * 方法：
 *   status()              授权状态、服务是否已连接、开关、已采条数、采集包名
 *   openPermission()      跳到系统「通知使用权」页面
 *   setEnabled({on})      采集总开关
 *   getItems({limit})     读取已采条目（JSON 字符串，新的在前）
 *   rescan()              主动回捞当前通知栏里的目标应用通知
 *   clear()               清空已采条目
 */
@CapacitorPlugin(name = "Capture")
public class CapturePlugin extends Plugin {

    /** 复用 CoursePlugin 的同一条通路：弱引用存活 WebView，让网页层及时刷新列表 */
    private static java.lang.ref.WeakReference<android.webkit.WebView> liveWebView;
    private static final android.os.Handler MAIN = new android.os.Handler(android.os.Looper.getMainLooper());

    private static final String WAKE_JS =
            "(function(){try{"
                    + "if(window.AiTodoCapture&&window.AiTodoCapture.onNativeWake){window.AiTodoCapture.onNativeWake();return 'ok';}"
                    + "}catch(e){}return 'none';})()";

    @Override
    public void load() {
        try {
            com.getcapacitor.Bridge b = getBridge();
            if (b != null) liveWebView = new java.lang.ref.WeakReference<android.webkit.WebView>(b.getWebView());
        } catch (Throwable ignored) {
        }
    }

    /** 由 CaptureService 在收到新通知后调用：让存活的网页层及时刷新（不在前台就跳过，数据仍在队列里） */
    public static void requestWake() {
        MAIN.post(() -> {
            try {
                android.webkit.WebView wv = liveWebView == null ? null : liveWebView.get();
                if (wv == null) return;
                wv.evaluateJavascript(WAKE_JS, null);
            } catch (Throwable ignored) {
            }
        });
    }

    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        JSObject r = new JSObject();
        r.put("granted", CaptureService.permissionGranted(ctx));
        r.put("connected", CaptureService.serviceConnected());
        r.put("enabled", CaptureService.enabled(ctx));
        r.put("count", CaptureService.itemCount(ctx));
        r.put("pkgs", CaptureService.packageList(ctx));
        r.put("sdk", android.os.Build.VERSION.SDK_INT);
        call.resolve(r);
    }

    @PluginMethod
    public void openPermission(PluginCall call) {
        try {
            Activity a = getActivity();
            Context c = a != null ? a : getContext();
            Intent i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
            call.resolve();
        } catch (Throwable t) {
            call.reject("打不开系统通知使用权页面：" + t.getMessage());
        }
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        Boolean on = call.getBoolean("on");
        CaptureService.setEnabled(getContext(), on == null || on);
        call.resolve();
    }

    @PluginMethod
    public void getItems(PluginCall call) {
        Integer limit = call.getInt("limit");
        JSObject r = new JSObject();
        r.put("items", CaptureService.itemsJson(getContext(), limit == null ? 0 : limit));
        call.resolve(r);
    }

    @PluginMethod
    public void rescan(PluginCall call) {
        int n = CaptureService.rescanNow(getContext());
        JSObject r = new JSObject();
        r.put("added", n);
        r.put("connected", CaptureService.serviceConnected());
        call.resolve(r);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        CaptureService.clearItems(getContext());
        call.resolve();
    }
}
