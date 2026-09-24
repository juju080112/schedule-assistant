package com.aitodo.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * 课程提醒本地引擎（v1.7.0）
 *
 * 数据流：网页层（course.js）在同步成功 / 设置变更 / 每次启动时，
 * 通过 CoursePlugin.syncAlarms(state) 把「课表 + 校历 + 作息表 + 设置」
 * 推给本类保存；本类按「当天 + 往后 3 天」窗口换算出每一节课的开始时间，
 * 用系统闹钟各排两条提醒（准点 + 提前 1 小时，与其他日程一致）。
 *
 * 每日自动同步：由 TimetableSyncService（每日 06:30 闹钟拉起）在后台
 * 无头 WebView 里复用已登录会话重新抓取课表，成功后回调 rescheduleAlarms。
 *
 * 合规边界：
 *   - 状态文件只含课表结构化数据（课程名/教师/地点/星期/节次/周次）、校历、作息与设置；
 *   - 不保存密码 / Cookie / Token / 原始 HTML；
 *   - 提醒全部在本地计算与触发，无任何服务端。
 */
public final class CourseAutoSync {

    static final String PREFS = "aitodo_course";
    static final String KEY_AUTO = "auto";              // 每日自动同步开关，默认开
    static final String KEY_ALARM_KEYS = "alarmKeys";   // 已排程课程提醒的 key 清单（用于整体重排前取消）
    static final String KEY_LAST_FAIL_NOTI = "lastFailNoti"; // 上次「同步失败」提醒时间，避免连发骚扰
    /* v1.8.20：后台同步（每日 06:30）只更新课表与提醒，课程日程条目由网页层展开。
       这里记一个「待展开」标记 + 后台同步时间戳，网页层启动/回前台/被原生唤起时据此展开。 */
    static final String KEY_PENDING_ROLL = "pendingRoll";
    static final String KEY_PENDING_AT = "pendingRollAt";
    static final String KEY_BACKEND_SYNC = "backendSyncAt";  // 最近一次后台同步时间戳（存 prefs，不被网页层 push 覆盖）
    static final String STATE_FILE = "course_state.json";

    static final int SYNC_REQUEST_CODE = 42301;
    static final int SYNC_HOUR = 6, SYNC_MINUTE = 30;   // 每日自动同步时间 06:30
    static final int WINDOW_DAYS = 4;                    // 当天 + 往后 3 天
    static final long PRE_LEAD_MS = 3600000L;            // 与其他日程一致：提前 1 小时
    static final long FAIL_NOTI_GAP = 20 * 3600000L;     // 失败提醒最少间隔

    private CourseAutoSync() {}

    /* ============ 开关 ============ */
    static boolean isAuto(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_AUTO, true);
    }

    static void setAuto(Context ctx, boolean on) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean(KEY_AUTO, on).apply();
        if (on) scheduleNextSync(ctx);
        else cancelSyncAlarm(ctx);
    }

    /* ============ 状态读写 ============ */
    static JSONObject loadState(Context ctx) {
        try {
            File f = new File(ctx.getFilesDir(), STATE_FILE);
            if (f.exists()) {
                FileInputStream fis = new FileInputStream(f);
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = fis.read(buf)) > 0) bo.write(buf, 0, n);
                fis.close();
                return new JSONObject(new String(bo.toByteArray(), StandardCharsets.UTF_8));
            }
        } catch (Exception ignored) {}
        return new JSONObject();
    }

    static boolean saveState(Context ctx, JSONObject st) {
        try {
            FileOutputStream fo = ctx.openFileOutput(STATE_FILE, Context.MODE_PRIVATE);
            fo.write(st.toString().getBytes(StandardCharsets.UTF_8));
            fo.close();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    static boolean hasData(Context ctx) {
        JSONObject st = loadState(ctx);
        JSONArray cs = st.optJSONArray("courses");
        return cs != null && cs.length() > 0 && !st.optString("lastGoodUrl", "").isEmpty();
    }

    /** 网页层推送新状态：落盘 → 重排提醒 → 保证每日同步闹钟在位 */
    static void applyState(Context ctx, String stateJson) {
        if (stateJson == null || stateJson.isEmpty()) return;
        try {
            JSONObject st = new JSONObject(stateJson);
            // 保留 native 侧自己维护的字段（下次抓取结果会覆盖 courses/syncedAt）
            JSONObject old = loadState(ctx);
            String lastUrl = st.optString("lastGoodUrl", "");
            if ((lastUrl == null || lastUrl.isEmpty()) && old.has("lastGoodUrl")) {
                st.put("lastGoodUrl", old.optString("lastGoodUrl", ""));
            }
            /* v1.8.20：后台同步时间戳只增不减。
               网页层每次 push 都会带一个自己的 syncedAt（可能是几天前的旧值），
               若直接覆盖，网页层的「原生结果是否更新」判定会把后台同步结果当成旧的丢弃。 */
            long oldBackend = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .getLong(KEY_BACKEND_SYNC, old.optLong("backendSyncAt", 0L));
            long oldSynced = Math.max(old.optLong("syncedAt", 0L), st.optLong("syncedAt", 0L));
            st.put("backendSyncAt", oldBackend);
            st.put("syncedAt", oldSynced);
            saveState(ctx, st);
        } catch (Exception e) {
            return;
        }
        rescheduleAlarms(ctx);
        if (isAuto(ctx)) scheduleNextSync(ctx);
    }

    /* ============ 校历换算（与 course.js 的规则保持一致） ============ */
    private static Calendar parseDate(String key) {
        try {
            String[] p = key.split("-");
            Calendar c = Calendar.getInstance();
            c.clear();
            c.set(Integer.parseInt(p[0]), Integer.parseInt(p[1]) - 1, Integer.parseInt(p[2]), 0, 0, 0);
            return c;
        } catch (Exception e) {
            return null;
        }
    }

    private static String dateKey(Calendar c) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(c.getTime());
    }

    /** 周一=1 … 周日=7 */
    private static int isoWeekday(Calendar c) {
        int dow = c.get(Calendar.DAY_OF_WEEK); // 1=周日 … 7=周六
        return (dow + 5) % 7 + 1;
    }

    /* ============ 重排课程提醒 ============ */
    static void rescheduleAlarms(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        cancelAll(ctx, am);

        JSONObject st = loadState(ctx);
        JSONObject settings = st.optJSONObject("settings");
        boolean enabled = settings == null || settings.optBoolean("enabled", true);
        JSONArray courses = st.optJSONArray("courses");
        if (!enabled || courses == null || courses.length() == 0) {
            saveAlarmKeys(ctx, new ArrayList<String>());
            return;
        }

        JSONObject termObj = st.optJSONObject("term");
        JSONObject term = termObj == null ? new JSONObject() : termObj;
        String anchor = term.optString("week1Sunday", "");
        int totalWeeks = term.optInt("totalWeeks", 20);
        JSONObject overrides = term.optJSONObject("overrides");
        if (overrides == null) overrides = new JSONObject();
        List<String> holidays = new ArrayList<String>();
        JSONArray hol = term.optJSONArray("holidays");
        if (hol != null) for (int i = 0; i < hol.length(); i++) holidays.add(hol.optString(i));
        JSONArray slotStart = st.optJSONArray("slotStart");

        Calendar anchorCal = parseDate(anchor);
        if (anchorCal == null || slotStart == null || slotStart.length() == 0) {
            saveAlarmKeys(ctx, new ArrayList<String>());
            return;
        }

        long now = System.currentTimeMillis();
        List<String> keys = new ArrayList<String>();
        /* v1.7.5：网页层推送的 skip 列表（已完成/已移除的节次），排程时跳过 */
        java.util.Set<String> skipSet = new java.util.HashSet<String>();
        JSONArray skArr = st.optJSONArray("skip");
        if (skArr != null) {
            for (int i = 0; i < skArr.length(); i++) {
                String sk = skArr.optString(i, "");
                if (!sk.isEmpty()) skipSet.add(sk);
            }
        }
        Calendar day = Calendar.getInstance();
        day.set(Calendar.HOUR_OF_DAY, 0);
        day.set(Calendar.MINUTE, 0);
        day.set(Calendar.SECOND, 0);
        day.set(Calendar.MILLISECOND, 0);

        for (int d = 0; d < WINDOW_DAYS; d++) {
            if (d > 0) day.add(Calendar.DAY_OF_YEAR, 1);
            String dk = dateKey(day);
            if (holidays.contains(dk)) continue;

            long weekNo = (day.getTimeInMillis() - anchorCal.getTimeInMillis()) / 86400000L / 7 + 1;
            if (weekNo < 1 || weekNo > totalWeeks) continue;

            int effWd = overrides.has(dk) ? overrides.optInt(dk, 0) : isoWeekday(day);
            if (effWd < 1 || effWd > 7) continue;

            for (int i = 0; i < courses.length(); i++) {
                JSONObject c = courses.optJSONObject(i);
                if (c == null) continue;
                if (c.optInt("weekday", 0) != effWd) continue;

                int ss = c.optInt("startSlot", 0);
                if (ss < 1 || ss > slotStart.length()) continue;
                JSONArray t = slotStart.optJSONArray(ss - 1);
                if (t == null || t.length() < 2) continue;

                JSONArray weeks = c.optJSONArray("weeks");
                if (weeks != null && weeks.length() > 0) {
                    boolean hit = false;
                    for (int w = 0; w < weeks.length(); w++) {
                        if (weeks.optLong(w) == weekNo) { hit = true; break; }
                    }
                    if (!hit) continue;
                }

                Calendar startCal = (Calendar) day.clone();
                startCal.set(Calendar.HOUR_OF_DAY, t.optInt(0, 8));
                startCal.set(Calendar.MINUTE, t.optInt(1, 0));
                startCal.set(Calendar.SECOND, 0);
                startCal.set(Calendar.MILLISECOND, 0);
                long startTs = startCal.getTimeInMillis();
                if (startTs <= now) continue;

                String name = c.optString("name", "课程");
                String loc = c.optString("location", "");
                String body = name + (loc.isEmpty() ? "" : " · " + loc);
                String hm = new SimpleDateFormat("HH:mm", Locale.US).format(new Date(startTs));
                String key = name + "|" + dk + "|" + ss;
                if (skipSet.contains(key)) continue; // 用户已标记完成/移除，不再提醒

                scheduleOne(ctx, am, key, startTs, "日程提醒", hm + " " + body, false);
                long pre = startTs - PRE_LEAD_MS;
                if (pre > now) scheduleOne(ctx, am, key, pre, "日程预提醒", "1 小时后开始：" + body, true);
                keys.add(key);
            }
        }
        saveAlarmKeys(ctx, keys);
    }

    /* ============ 单条闹钟 ============ */
    private static int piFlags() {
        return PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
    }

    private static void scheduleOne(Context ctx, AlarmManager am, String key, long at,
                                    String title, String body, boolean pre) {
        if (at <= System.currentTimeMillis()) return;
        int code = alarmCode(key, pre);
        Intent i = new Intent(ctx, CourseAlarmReceiver.class);
        i.setAction("com.aitodo.app.COURSE_ALARM");
        i.putExtra("nid", code);
        i.putExtra("title", title);
        i.putExtra("body", body);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, code, i, piFlags());
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (Exception e) {
            try { am.set(AlarmManager.RTC_WAKEUP, at, pi); } catch (Exception ignored) {}
        }
    }

    private static void cancelOne(Context ctx, AlarmManager am, String key, boolean pre) {
        int code = alarmCode(key, pre);
        Intent i = new Intent(ctx, CourseAlarmReceiver.class);
        i.setAction("com.aitodo.app.COURSE_ALARM");
        PendingIntent pi = PendingIntent.getBroadcast(ctx, code, i, piFlags());
        am.cancel(pi);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(code);
    }

    private static int alarmCode(String key, boolean pre) {
        return ((pre ? "P|" : "M|") + key).hashCode() & 0x7fffffff;
    }

    private static List<String> loadAlarmKeys(Context ctx) {
        List<String> out = new ArrayList<String>();
        try {
            JSONArray a = new JSONArray(
                    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_ALARM_KEYS, "[]"));
            for (int i = 0; i < a.length(); i++) out.add(a.optString(i));
        } catch (Exception ignored) {}
        return out;
    }

    private static void saveAlarmKeys(Context ctx, List<String> keys) {
        JSONArray a = new JSONArray();
        for (String k : keys) a.put(k);
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(KEY_ALARM_KEYS, a.toString()).apply();
    }

    static void cancelAll(Context ctx, AlarmManager am) {
        for (String k : loadAlarmKeys(ctx)) {
            cancelOne(ctx, am, k, false);
            cancelOne(ctx, am, k, true);
        }
    }

    /* ============ 每日自动同步闹钟 ============ */
    private static PendingIntent syncPI(Context ctx) {
        Intent i = new Intent(ctx, TimetableSyncService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return PendingIntent.getForegroundService(ctx, SYNC_REQUEST_CODE, i, piFlags());
        }
        return PendingIntent.getService(ctx, SYNC_REQUEST_CODE, i, piFlags());
    }

    static void scheduleNextSync(Context ctx) {
        if (!isAuto(ctx)) return;
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, SYNC_HOUR);
        cal.set(Calendar.MINUTE, SYNC_MINUTE);
        cal.set(Calendar.SECOND, 0);
        if (cal.getTimeInMillis() <= System.currentTimeMillis() + 60000L) {
            cal.add(Calendar.DAY_OF_YEAR, 1);
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), syncPI(ctx));
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), syncPI(ctx));
            }
        } catch (Exception e) {
            try { am.set(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), syncPI(ctx)); } catch (Exception ignored) {}
        }
    }

    static void cancelSyncAlarm(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        am.cancel(syncPI(ctx));
    }

    /* ============ v1.8.20：后台同步 → 网页层展开课程日程 ============ */

    /** 后台同步成功：记下时间戳，并标记「网页层需重新展开未来三天的课程日程」 */
    static void markPendingRoll(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        sp.edit()
                .putLong(KEY_BACKEND_SYNC, now)
                .putLong(KEY_PENDING_AT, now)
                .putBoolean(KEY_PENDING_ROLL, true)
                .apply();
    }

    static boolean hasPendingRoll(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_PENDING_ROLL, false);
    }

    /** 网页层已采纳后台结果（展开完成）→ 清标记 */
    static void clearPendingRoll(Context ctx) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean(KEY_PENDING_ROLL, false).apply();
    }

    static long backendSyncAt(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_BACKEND_SYNC, 0L);
    }

    /* ============ 失败提醒节流 ============ */
    static boolean shouldNotifyFail(Context ctx) {
        long last = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_LAST_FAIL_NOTI, 0L);
        return System.currentTimeMillis() - last > FAIL_NOTI_GAP;
    }

    static void noteFail(Context ctx) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putLong(KEY_LAST_FAIL_NOTI, System.currentTimeMillis()).apply();
    }

    /* ============ 小工具 ============ */
    static String readAsset(Context ctx, String name) {
        InputStream in = null;
        try {
            in = ctx.getAssets().open(name);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        } finally {
            if (in != null) try { in.close(); } catch (Exception ignored) {}
        }
    }

    /** 发布一条即时提醒（用于自动同步失败提示，走与其他日程相同的 reminders-v2 通道） */
    static void postAlert(Context ctx, String title, String body) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            String ch = "reminders-v2";
            if (nm.getNotificationChannel(ch) == null) {
                NotificationChannel c = new NotificationChannel(ch, "日程提醒", NotificationManager.IMPORTANCE_HIGH);
                c.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                nm.createNotificationChannel(c);
            }
            Notification n = new androidx.core.app.NotificationCompat.Builder(ctx, ch)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new androidx.core.app.NotificationCompat.BigTextStyle().bigText(body))
                    .setSmallIcon(ctx.getApplicationInfo().icon)
                    .setAutoCancel(true)
                    .build();
            nm.notify(42901, n);
        } catch (Exception ignored) {}
    }
}
