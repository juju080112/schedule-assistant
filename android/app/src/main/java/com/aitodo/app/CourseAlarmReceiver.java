package com.aitodo.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.app.NotificationCompat;

/**
 * 课程提醒闹钟接收器（v1.7.0）
 * 由 CourseAutoSync 用系统闹钟精确拉起，发布「日程提醒 / 日程预提醒」通知。
 * 通道与其他日程一致（reminders-v2），提醒时机也一致：准点 + 提前 1 小时。
 */
public class CourseAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            String title = intent.getStringExtra("title");
            String body = intent.getStringExtra("body");
            int nid = intent.getIntExtra("nid", 0);
            if (title == null || title.isEmpty()) return;
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            String ch = "reminders-v2";
            if (nm.getNotificationChannel(ch) == null) {
                NotificationChannel c = new NotificationChannel(ch, "日程提醒", NotificationManager.IMPORTANCE_HIGH);
                c.setDescription("日程准点与提前1小时提醒");
                c.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                nm.createNotificationChannel(c);
            }
            Notification n = new NotificationCompat.Builder(context, ch)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                    .setSmallIcon(context.getApplicationInfo().icon)
                    .setAutoCancel(true)
                    .build();
            nm.notify(nid, n);
        } catch (Exception ignored) {}
    }
}
