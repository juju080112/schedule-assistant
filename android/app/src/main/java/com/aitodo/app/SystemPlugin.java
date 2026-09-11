package com.aitodo.app;

import android.app.Activity;
import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * v1.8.1：系统权限自检与引导。
 * 供「使用指南」页展示通知权限、精确闹钟、电池优化白名单的当前状态，
 * 并一键跳到对应的系统设置页（各品牌后台保活页无法通用跳转，由指南文字引导）。
 */
@CapacitorPlugin(name = "SystemInfo")
public class SystemPlugin extends Plugin {

    /** 当前各项权限/设置状态 + 厂商信息（用于在指南里优先展示对应品牌的步骤） */
    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        JSObject out = new JSObject();

        boolean notify = true;
        try {
            notify = NotificationManagerCompat.from(ctx).areNotificationsEnabled();
        } catch (Exception ignored) {
        }
        out.put("notifications", notify);

        out.put("exactAlarm", canExactAlarm(ctx));
        out.put("sdk", Build.VERSION.SDK_INT);

        boolean batteryOk = true;
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                batteryOk = pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
            }
        } catch (Exception ignored) {
        }
        out.put("batteryUnrestricted", batteryOk);

        String brand = String.valueOf(Build.MANUFACTURER == null ? "" : Build.MANUFACTURER).toLowerCase();
        out.put("manufacturer", brand);
        out.put("model", String.valueOf(Build.MODEL == null ? "" : Build.MODEL));
        call.resolve(out);
    }

    /** 是否可排精确闹钟（Android 12 以下恒为 true） */
    private boolean canExactAlarm(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            return am == null || am.canScheduleExactAlarms();
        } catch (Exception e) {
            return true;
        }
    }

    /** 打开「闹钟与提醒」授权页（Android 12+；以下版本直接打开应用详情） */
    @PluginMethod
    public void requestExactAlarm(PluginCall call) {
        Activity act = getActivity();
        if (act == null) {
            call.resolve();
            return;
        }
        boolean opened = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                Intent i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                i.setData(Uri.parse("package:" + act.getPackageName()));
                act.startActivity(i);
                opened = true;
            } catch (Exception ignored) {
            }
            if (!opened) {
                try {
                    act.startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM));
                    opened = true;
                } catch (Exception ignored) {
                }
            }
        }
        if (!opened) openAppDetails(act);
        call.resolve();
    }

    /** 申请忽略电池优化（部分国产系统会直接弹「允许后台运行」确认框） */
    @PluginMethod
    public void requestIgnoreBattery(PluginCall call) {
        Activity act = getActivity();
        if (act == null) {
            call.resolve();
            return;
        }
        boolean opened = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                i.setData(Uri.parse("package:" + act.getPackageName()));
                act.startActivity(i);
                opened = true;
            } catch (Exception ignored) {
            }
        }
        if (!opened) openAppDetails(act);
        call.resolve();
    }

    /** 打开本应用的系统设置详情页（自启动、权限、通知等入口都在这里） */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Activity act = getActivity();
        if (act != null) openAppDetails(act);
        call.resolve();
    }

    /** 打开通知设置页（Android 8+ 可直达本应用通知设置） */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Activity act = getActivity();
        if (act == null) {
            call.resolve();
            return;
        }
        boolean opened = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                i.putExtra(Settings.EXTRA_APP_PACKAGE, act.getPackageName());
                act.startActivity(i);
                opened = true;
            } catch (Exception ignored) {
            }
        }
        if (!opened) openAppDetails(act);
        call.resolve();
    }

    private void openAppDetails(Activity act) {
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            i.setData(Uri.parse("package:" + act.getPackageName()));
            act.startActivity(i);
        } catch (Exception ignored) {
        }
    }
}
