package com.aitodo.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.text.TextUtils;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 每日自动课表同步服务（v1.7.0）
 *
 * 由每日 06:30 的精确闹钟以前台服务方式拉起（CourseAutoSync.scheduleNextSync），
 * 在后台无头 WebView 里加载上次成功抓取的课表页地址：
 *   - 会话复用：Cookie 保存在系统 WebView 存储里（登录窗口不再清除），
 *     本服务不读取、不导出任何 Cookie，只是让学校网关认得「这个浏览器还登录着」；
 *   - 只读抓取：复用 course-extract.js（接口直取 / 属性网格 / 表格遍历），
 *     不发任何写操作，不读表单值；
 *   - 成功：更新本地课表数据 → 重排「当天+3天」的课程提醒 → 静默结束；
 *   - 失败（登录过期等）：发一条提醒通知请用户打开 App 手动同步（有节流）。
 * 无论成败都续排明天的闹钟。
 */
public class TimetableSyncService extends Service {

    private static final int FG_ID = 42200;
    private static final String FG_CHANNEL = "course-sync";

    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView wv;
    private boolean done = false;
    private boolean genericInjected = false;
    private int pollLeft = 0;
    private String extractScript;
    private String ustcScript;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForegroundNow();
        main.postDelayed(this::run, 400);
        return START_NOT_STICKY;
    }

    private void startForegroundNow() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null && nm.getNotificationChannel(FG_CHANNEL) == null) {
            NotificationChannel c = new NotificationChannel(FG_CHANNEL, "课表自动同步", NotificationManager.IMPORTANCE_LOW);
            c.setDescription("每天自动同步课表时的短暂后台活动提示");
            nm.createNotificationChannel(c);
        }
        Notification n = new NotificationCompat.Builder(this, FG_CHANNEL)
                .setContentTitle("正在自动同步课表…")
                .setSmallIcon(getApplicationInfo().icon)
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(FG_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(FG_ID, n);
        }
    }

    private void run() {
        if (done) return;
        if (!CourseAutoSync.isAuto(this)) { finish(); return; }
        if (!CourseAutoSync.hasData(this)) { finish(); return; } // 尚未手动同步过，等用户先登录一次
        String url = CourseAutoSync.loadState(this).optString("lastGoodUrl", "");
        if (TextUtils.isEmpty(url)) { finish(); return; }
        extractScript = CourseAutoSync.readAsset(this, "course-extract.js");
        ustcScript = CourseAutoSync.readAsset(this, "course-ustc.js");
        if (extractScript == null && ustcScript == null) { fail("内置提取脚本缺失"); return; }
        try {
            wv = new WebView(this);
            WebSettings s = wv.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            /* v1.7.5：仅手机版默认 UA，与 MyUSTC 一致 */
            s.setBlockNetworkImage(true);
            s.setCacheMode(WebSettings.LOAD_DEFAULT);
            CookieManager.getInstance().setAcceptCookie(true);
            wv.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String u) {
                    main.postDelayed(() -> inject(view), 3000); // 等前端框架渲染完成
                }
            });
            wv.loadUrl(url);
            main.postDelayed(() -> fail("同步超时"), 75000);
        } catch (Throwable t) {
            fail("同步失败：" + t.getMessage());
        }
    }

    private void inject(WebView view) {
        if (done) return;
        /* MyUSTC 同款自动抓取：注入轮询脚本，等课表页特征出现即调官方 JSON 接口 */
        if (ustcScript != null) {
            /* 传入学期锚点（校历），供接口数据里只有起止日期时推算教学周 */
            String cfg = "";
            try {
                JSONObject term = CourseAutoSync.loadState(this).optJSONObject("term");
                if (term != null) {
                    String w1s = term.optString("week1Sunday", "2026-08-30");
                    int tw = term.optInt("totalWeeks", 20);
                    cfg = "window.__aitodoUstcCfg={week1Sunday:\"" + w1s + "\",totalWeeks:" + tw + "};";
                }
            } catch (Exception ignored) {}
            view.evaluateJavascript(ustcScript
                    + "\n;" + cfg
                    + "window.__aitodoUstcReset && window.__aitodoUstcReset();"
                    + "window.__aitodoUstcStart && window.__aitodoUstcStart();", null);
        }
        /* 兜底：6.5 秒后仍未得到结果，补注入通用 DOM 解析 */
        main.postDelayed(() -> {
            if (done || genericInjected) return;
            genericInjected = true;
            if (extractScript != null) {
                String boot = extractScript
                        + "\n;if (!window.__aitodoLastResult) window.__aitodoExtract(function(s){ if (!window.__aitodoLastResult) window.__aitodoLastResult = s; },{skeleton:false});";
                view.evaluateJavascript(boot, null);
            }
        }, 6500);
        pollLeft = 110; // 110 × 500ms = 55s
        poll();
    }

    private void poll() {
        if (done || wv == null) return;
        if (pollLeft-- <= 0) { fail("同步超时"); return; }
        wv.evaluateJavascript("window.__aitodoLastResult", value -> {
            if (done) return;
            if (value != null && value.length() > 2 && !value.equals("null")) {
                handleResult(CourseLoginActivity.unquoteJsonString(value));
            } else {
                main.postDelayed(this::poll, 500);
            }
        });
    }

    private void handleResult(String reportJson) {
        try {
            JSONObject r = new JSONObject(reportJson == null ? "{}" : reportJson);
            JSONArray cs = r.optJSONArray("courses");
            boolean ok = r.optBoolean("ok", false) && cs != null && cs.length() > 0;
            if (!ok) {
                fail("课表自动同步未成功（可能登录已过期），请打开 App 手动同步一次");
                return;
            }
            JSONObject st = CourseAutoSync.loadState(this);
            JSONArray keep = new JSONArray();
            for (int i = 0; i < cs.length(); i++) {
                JSONObject c = cs.optJSONObject(i);
                if (c == null) continue;
                JSONObject o = new JSONObject();
                o.put("name", c.optString("name"));
                o.put("teacher", c.optString("teacher"));
                o.put("location", c.optString("location"));
                o.put("weekday", c.optInt("weekday"));
                o.put("startSlot", c.optInt("startSlot"));
                o.put("endSlot", c.optInt("endSlot"));
                JSONArray weeks = c.optJSONArray("weeks");
                o.put("weeks", weeks == null ? new JSONArray() : weeks);
                o.put("raw", "");
                keep.put(o);
            }
            st.put("courses", keep);
            long now = System.currentTimeMillis();
            st.put("syncedAt", now);
            st.put("backendSyncAt", now);
            /* 自动同步同样用教务页面的开学日期校准「第1周周日」锚点 */
            JSONObject term = r.optJSONObject("term");
            if (term != null) {
                String w1s = term.optString("week1Sunday", "");
                if (w1s.matches("\\d{4}-\\d{2}-\\d{2}")) {
                    JSONObject stTerm = st.optJSONObject("term");
                    if (stTerm == null) stTerm = new JSONObject();
                    stTerm.put("week1Sunday", w1s);
                    st.put("term", stTerm);
                }
            }
            CourseAutoSync.saveState(this, st);
            CourseAutoSync.rescheduleAlarms(this);
            /* v1.8.20：课表刷新后必须让课程日程条目也跟着滚动续排。
               ① 标记「待展开」，网页层下次启动/回前台时会据此重新展开未来三天；
               ② 若 App 此刻仍在前台（WebView 存活），直接唤起网页层立即展开，不等下次打开。 */
            CourseAutoSync.markPendingRoll(this);
            CoursePlugin.requestRoll();
            finish();
        } catch (Throwable t) {
            fail("课表自动同步异常：" + t.getMessage());
        }
    }

    private void fail(String msg) {
        if (CourseAutoSync.shouldNotifyFail(this)) {
            CourseAutoSync.noteFail(this);
            CourseAutoSync.postAlert(this, "课表自动同步失败", msg);
        }
        finish();
    }

    private void finish() {
        if (done) return;
        done = true;
        CourseAutoSync.scheduleNextSync(this); // 无条件续排明天
        main.postDelayed(() -> {
            if (wv != null) {
                try {
                    wv.stopLoading();
                    wv.loadUrl("about:blank");
                    wv.destroy();
                } catch (Exception ignored) {}
                wv = null;
            }
            try { stopForeground(true); } catch (Exception ignored) {}
            stopSelf();
        }, 300);
    }

    @Override
    public void onDestroy() {
        if (wv != null) {
            try { wv.destroy(); } catch (Exception ignored) {}
            wv = null;
        }
        super.onDestroy();
    }
}
