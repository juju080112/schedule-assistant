package com.aitodo.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.content.ContextCompat;

/**
 * 开机自启：恢复今日日程常驻栏 + 每日课表自动同步闹钟（v1.7.0）。
 * - 需要系统「自启动」权限才会收到开机广播（vivo: i管家/设置 里允许）
 * - 常驻栏内容用 SharedPreferences 缓存（上次推送的日程），用户打开 App 后自动更新为最新
 * - 常驻栏被用户在 App 内关闭时（enabled=false）不启动；课表同步闹钟独立恢复
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent == null ? null : intent.getAction();
        if (a == null) return;
        boolean boot = Intent.ACTION_BOOT_COMPLETED.equals(a)
                || "android.intent.action.QUICKBOOT_POWERON".equals(a);
        if (!boot) return;
        SharedPreferences p = context.getSharedPreferences(BarService.PREFS, Context.MODE_PRIVATE);
        if (p.getBoolean(BarService.KEY_ENABLED, false)) {
            try {
                Intent i = new Intent(context, BarService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ContextCompat.startForegroundService(context, i);
                } else {
                    context.startService(i);
                }
            } catch (Exception ignored) {
            }
        }
        // v1.7.0：开机后续排每日课表自动同步（CourseAutoSync 内部会检查开关与是否已有课表数据）
        try {
            CourseAutoSync.scheduleNextSync(context);
        } catch (Exception ignored) {
        }
    }
}
