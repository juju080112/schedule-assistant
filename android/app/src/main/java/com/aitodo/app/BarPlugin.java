package com.aitodo.app;

import android.app.Activity;
import android.graphics.Color;
import android.view.View;
import android.view.Window;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** 网页层 ↔ 原生常驻栏服务 / 主题 的桥 */
@CapacitorPlugin(name = "BarService")
public class BarPlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        String title = call.getString("title");
        String body = call.getString("body");
        BarService.push(getContext(), title, body);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        BarService.stop(getContext());
        call.resolve();
    }

    /**
     * v1.8.0 主题切换：同步状态栏 / 导航栏底色与图标明暗、WebView 底色，
     * 使深色模式下状态栏图标为浅色、系统栏背景与页面一致（避免白边）。
     */
    @PluginMethod
    public void setTheme(PluginCall call) {
        final boolean dark = call.getBoolean("dark", false);
        final Activity act = getActivity();
        if (act == null) {
            call.resolve();
            return;
        }
        final int bg = Color.parseColor(dark ? "#0F1216" : "#F1F3F5");
        act.runOnUiThread(() -> {
            try {
                Window w = act.getWindow();
                w.setStatusBarColor(bg);
                w.setNavigationBarColor(bg);
                View decor = w.getDecorView();
                int flags = decor.getSystemUiVisibility();
                if (dark) {
                    flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                    flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                } else {
                    flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                    flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                }
                decor.setSystemUiVisibility(flags);
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().setBackgroundColor(bg);
                }
            } catch (Exception ignored) {
            }
        });
        call.resolve();
    }
}
