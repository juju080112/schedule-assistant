package com.aitodo.app;

import android.app.AlarmManager;
import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * 常驻今日日程栏（v1.4.5 双通知 + 动态 ongoing 切换）
 * - 999998：前台服务保活通知（渠道已被用户在系统里关闭，仅满足系统硬性要求）——扛 vivo 清理
 * - 999999：今日日程条。OriginOS 锁屏规则（真机实测）：
 *   ① 只有"熄屏期间到达/刷新"的通知才上锁屏（AOD 不受限）；
 *   ② 带 ONGOING 标记的通知不上锁屏列表（前台服务标记同理）。
 *   所以采用动态切换：亮屏时 ONGOING=true（常驻叉不掉），
 *   熄屏瞬间重发 ONGOING=false（新到达 → 上锁屏），
 *   解锁(USER_PRESENT)瞬间恢复 ONGOING=true（此时锁屏已消失，无竞态）。
 * - 内容由网页层经 BarPlugin.push 推送，SharedPreferences 持久化以便进程被杀后恢复。
 */
public class BarService extends Service {
    public static final int BAR_ID = 999999;
    public static final int SVC_ID = 999998;
    public static final String CHANNEL_ID = "today-bar-v4";
    public static final String SVC_CHANNEL_ID = "bar-service-v2";
    static final String PREFS = "aitodo_bar";
    private static final String KEY_TITLE = "title";
    private static final String KEY_BODY = "body";
    static final String KEY_ENABLED = "enabled";

    private BroadcastReceiver eventReceiver = null;
    private final Handler watchdog = new Handler(Looper.getMainLooper());
    private Runnable watchdogTask = null;
    private boolean lastPostedOngoing = false;

    /** 保存最新内容并确保服务运行（网页层每次日程变化都会调用） */
    public static void push(Context ctx, String title, String body) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_TITLE, title == null ? "今日日程" : title)
                .putString(KEY_BODY, body == null ? "" : body)
                .putBoolean(KEY_ENABLED, true)
                .apply();
        Intent i = new Intent(ctx, BarService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ContextCompat.startForegroundService(ctx, i);
        } else {
            ctx.startService(i);
        }
    }

    /** 关闭常驻栏：标记停用（开机不再自启）、停止服务并清掉两条通知 */
    public static void stop(Context ctx) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_ENABLED, false)
                .apply();
        ctx.stopService(new Intent(ctx, BarService.class));
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.cancel(BAR_ID);
            nm.cancel(SVC_ID);
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureChannels();
        startKeepAlive();
        syncBar();
        registerEventReceivers();
        startWatchdog();
        return START_STICKY;
    }

    /** 前台保活通知（最低重要度） */
    private void startKeepAlive() {
        Notification n = new NotificationCompat.Builder(this, SVC_CHANNEL_ID)
                .setContentTitle("日程助手")
                .setContentText("日程提醒服务运行中")
                .setSmallIcon(getApplicationInfo().icon)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(SVC_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(SVC_ID, n);
        }
        // vivo 不尊重 IMPORTANCE_NONE 渠道：挂前台满足系统硬性要求后，随即撤下展示
        // （Android 13+ 允许取消前台服务通知的展示；服务与熄屏刷新不受影响）
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(SVC_ID);
        } catch (Exception ignored) {
        }
    }

    /**
     * 统一状态函数：亮屏且未锁屏 → 常驻（叉不掉）；其余（熄屏/锁屏中/AOD）→ 普通通知（可上锁屏）。
     * 所有屏幕事件与看门狗都收敛到这一处，任何错过的事件都会被下一次心跳纠正。
     */
    private void syncBar() {
        refreshBar(shouldPin());
    }

    private boolean shouldPin() {
        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        boolean locked = km != null && km.isKeyguardLocked();
        return isScreenOn() && !locked;
    }

    /**
     * 刷新今日日程条。
     * ongoing=true：常驻（叉不掉，锁屏期间不可用此形态）；
     * ongoing=false：锁屏可显示（仅在熄屏/锁屏窗口内使用）。
     */
    private void refreshBar(boolean ongoing) {
        try {
            lastPostedOngoing = ongoing;
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(BAR_ID, buildBar(ongoing));
        } catch (Exception ignored) {
        }
    }

    private boolean isScreenOn() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isInteractive();
    }

    /** 看门狗：每 45 秒校正一次形态（也把被误叉的通知补回来） */
    private void startWatchdog() {
        if (watchdogTask != null) return;
        watchdogTask = new Runnable() {
            @Override
            public void run() {
                try {
                    if (shouldPin() != lastPostedOngoing) syncBar();
                } catch (Exception ignored) {
                }
                watchdog.postDelayed(this, 45000);
            }
        };
        watchdog.postDelayed(watchdogTask, 45000);
    }

    private void registerEventReceivers() {
        if (eventReceiver != null) return;
        eventReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                try {
                    syncBar();
                } catch (Exception ignored) {
                }
            }
        };
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_SCREEN_OFF);
        f.addAction(Intent.ACTION_SCREEN_ON);
        f.addAction(Intent.ACTION_USER_PRESENT);
        ContextCompat.registerReceiver(this, eventReceiver, f, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    private Notification buildBar(boolean ongoing) {
        SharedPreferences p = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String title = p.getString(KEY_TITLE, "今日日程");
        String body = p.getString(KEY_BODY, "打开应用查看与更新");
        Intent launch = new Intent(this, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, BAR_ID, launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setSmallIcon(getApplicationInfo().icon)
                .setOngoing(ongoing)
                .setOnlyAlertOnce(true)
                .setAutoCancel(false)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(pi)
                .build();
    }

    private void ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "今日日程栏", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("通知栏与锁屏常驻显示当天日程，点击不消失");
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
        try {
            if (nm.getNotificationChannel("bar-service") != null) nm.deleteNotificationChannel("bar-service");
        } catch (Exception ignored) {
        }
        if (nm.getNotificationChannel(SVC_CHANNEL_ID) == null) {
            // IMPORTANCE_NONE：该类别通知不显示在通知栏（前台服务保活用，服务本身照常运行）
            NotificationChannel ch2 = new NotificationChannel(SVC_CHANNEL_ID, "后台服务", NotificationManager.IMPORTANCE_NONE);
            ch2.setDescription("日程提醒服务的后台运行标识");
            ch2.setLockscreenVisibility(Notification.VISIBILITY_SECRET);
            nm.createNotificationChannel(ch2);
        }
    }

    /**
     * 清后台垂死挣扎：vivo 清理最近任务会连前台服务一起杀。
     * ① 立即尝试自拉起；② 在系统闹钟里埋 4 秒后的复活闹钟（闹钟由系统持有，进程死了也照响）。
     * 复活后 App 在最近任务里没有卡片，后续清理就杀不到它（与开机自启同效）。
     */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        try {
            Intent i = new Intent(this, BarService.class);
            ContextCompat.startForegroundService(this, i);
        } catch (Exception ignored) {
        }
        try {
            AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
            if (am != null) {
                boolean exactOk = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
                // 主复活闹钟 +2 秒，备份 +6 秒（防 vivo 杀进程慢于 2 秒时闹钟扑空）
                int[] codes = {1001, 1002};
                long[] delays = {2000, 6000};
                for (int k = 0; k < codes.length; k++) {
                    Intent i = new Intent(this, BarService.class);
                    PendingIntent pi = PendingIntent.getForegroundService(this, codes[k], i,
                            PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                    long triggerAt = System.currentTimeMillis() + delays[k];
                    if (exactOk) {
                        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                    } else {
                        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                    }
                }
            }
        } catch (Exception ignored) {
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (watchdogTask != null) {
            watchdog.removeCallbacks(watchdogTask);
            watchdogTask = null;
        }
        if (eventReceiver != null) {
            try {
                unregisterReceiver(eventReceiver);
            } catch (Exception ignored) {
            }
            eventReceiver = null;
        }
        super.onDestroy();
    }
}
