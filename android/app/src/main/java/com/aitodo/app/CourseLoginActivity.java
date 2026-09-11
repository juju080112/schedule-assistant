package com.aitodo.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.io.InputStream;

/**
 * 课表登录/抓取窗口（v1.7.1，严格参照 MyUSTC 的实现方式）
 *
 * 与 MyUSTC 相同的三个关键点：
 *   1. 直达课表页：入口 URL 就是 /for-std/course-table，未登录时 CAS 网关
 *      自动 302 到统一身份认证，登录成功后原样落回课表页；
 *   2. 自动抓取：每个页面加载完成后注入轮询脚本（每 500ms 检测课表页特征
 *      —— .item 学期元素、#startDate 开学日期、URL 末段为打印视图 id），
 *      特征出现即同源 GET 官方课表 JSON 接口，用户无需在正确时机按按钮；
 *   3. 数据主动推回：页面脚本通过 JavascriptInterface（window.Android
 *      .importCourse）把结果推回原生，同时写入 window.__aitodoLastResult
 *      作为备份通道，不依赖任何回调链路。
 *
 * 合规底线不变：用户亲手登录、密码不经代码层；只读 GET、零写操作；
 * 不读 Cookie/表单值；数据只落本机（course_raw.json + 返回 Intent）。
 */
public class CourseLoginActivity extends Activity {

    public static final String EXTRA_URL = "url";
    public static final String EXTRA_RESULT = "result";
    public static final String EXTRA_GRAB_URL = "grabUrl";
    /** 抓取结果文件（JavascriptInterface 与 Intent 双通道的兜底备份） */
    public static final String RAW_FILE = "course_raw.json";

    /** 直达课表页：未登录会被 CAS 踢去登录页，登录后自动落回这里（MyUSTC 同款流程） */
    private static final String DEFAULT_URL = "https://jw.ustc.edu.cn/for-std/course-table";

    /** 命中这些关键词说明大概率已经进到课表页 */
    private static final String[] SCHEDULE_HINTS = {
            "schedule", "timetable", "kcb", "xsjb", "coursetable", "courseTable",
            "course-table", "jsxsd", "kb", "课表"
    };

    private WebView webView;
    private ProgressBar progress;
    private TextView status;
    private Button btnGrab;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private String extractScript;
    private String ustcScript;
    /** 已完成（成功返回或取消）后忽略后续推送 */
    private boolean completed = false;
    private boolean genericInjected = false;
    /** 备份轮询是否在跑 */
    private boolean polling = false;
    private int pollLeft = 0;
    private Runnable pollTask;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        extractScript = readAsset(this, "course-extract.js");
        ustcScript = readAsset(this, "course-ustc.js");
        if (ustcScript == null && extractScript == null) {
            Toast.makeText(this, "内置课表提取脚本缺失，无法抓取", Toast.LENGTH_LONG).show();
            finishCancel("内置脚本缺失");
            return;
        }

        setContentView(buildUi());

        String url = getIntent().getStringExtra(EXTRA_URL);
        if (TextUtils.isEmpty(url)) url = DEFAULT_URL;

        configureWebView();
        webView.loadUrl(url);
        startBackupPoll();
    }

    /* ============ 界面（纯代码构建，保持与 App 主题一致） ============ */
    private View buildUi() {
        int primary = Color.parseColor("#0A59F7");
        int border = Color.parseColor("#E5E8EC");
        int textSub = Color.parseColor("#8A919F");
        int textMain = Color.parseColor("#182431");

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.setBackgroundColor(Color.parseColor("#F1F3F5"));

        webView = new WebView(this);
        LinearLayout.LayoutParams wvLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        webView.setLayoutParams(wvLp);
        root.addView(webView);

        /* 底部面板 */
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackgroundColor(Color.WHITE);
        panel.setPadding(dp(14), dp(10), dp(14), dp(14));
        root.addView(panel, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        panel.addView(progress, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));

        status = new TextView(this);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f);
        status.setTextColor(textSub);
        status.setPadding(0, dp(9), 0, dp(9));
        status.setText("登录成功进入「我的课表」后会自动抓取并返回，无需手动操作；也可随时点「重新抓取」。");
        panel.addView(status, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        panel.addView(row, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        btnGrab = new Button(this);
        btnGrab.setText("重新抓取");
        btnGrab.setTextColor(Color.WHITE);
        btnGrab.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f);
        btnGrab.setTypeface(Typeface.DEFAULT_BOLD);
        btnGrab.setBackgroundColor(primary);
        btnGrab.setPadding(0, dp(13), 0, dp(13));
        btnGrab.setOnClickListener(v -> startGrab());
        LinearLayout.LayoutParams grabLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        row.addView(btnGrab, grabLp);

        Button btnClose = new Button(this);
        btnClose.setText("关闭");
        btnClose.setTextColor(textMain);
        btnClose.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f);
        btnClose.setBackgroundColor(Color.parseColor("#F1F3F5"));
        btnClose.setPadding(dp(14), dp(13), dp(14), dp(13));
        btnClose.setOnClickListener(v -> finishCancel("用户取消"));
        LinearLayout.LayoutParams closeLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        closeLp.leftMargin = dp(8);
        row.addView(btnClose, closeLp);

        /* 顶部细线，视觉上与网页区分开 */
        View divider = new View(this);
        divider.setBackgroundColor(border);
        LinearLayout outer = new LinearLayout(this);
        outer.setOrientation(LinearLayout.VERTICAL);
        outer.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        outer.addView(root, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        return outer;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    /* ============ WebView 配置 ============ */
    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);       // 现代教务系统普遍依赖 localStorage
        s.setDatabaseEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setSupportMultipleWindows(false);  // 认证页若 window.open 也在本页加载，便于统一管理
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setTextZoom(100);
        /* v1.7.5：仅使用系统默认（手机版）UA，与 MyUSTC 一致，不再提供切换 */

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        /* MyUSTC 同款数据通道：页面脚本通过 window.Android.importCourse 主动推回结果。
         * 接口只接收字符串，不暴露任何读取能力；只有用户本人登录的学校页面会运行它。 */
        webView.addJavascriptInterface(new PageBridge(), "Android");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setProgress(newProgress);
                progress.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request == null || request.getUrl() == null) return false;
                String scheme = request.getUrl().getScheme();
                /* 只放行 http/https，其余（微信、支付宝、tel 等）一律不在本窗口打开 */
                if (scheme == null || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))) {
                    return true;
                }
                return false;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (!completed) setStatus("正在加载：" + hostOf(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                if (completed) return;
                injectAutoScript();
                String lower = url == null ? "" : url.toLowerCase();
                String title = view.getTitle() == null ? "" : view.getTitle();
                boolean onSchedule = false;
                for (String k : SCHEDULE_HINTS) {
                    if (lower.contains(k.toLowerCase()) || title.contains("课表")) { onSchedule = true; break; }
                }
                if (onSchedule) {
                    setStatus("✔ 已进入课表页，正在自动抓取…（无需任何操作）");
                } else if (lower.contains("id.ustc.edu.cn") || lower.contains("passport.ustc.edu.cn")) {
                    setStatus("请在上方页面亲手输入学工号与密码登录，登录后会自动跳回课表页并抓取。");
                } else {
                    setStatus("已打开：" + safeTitle(title) + "。请进入「我的课表」页面，会自动抓取。");
                }
                btnGrab.setEnabled(true);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request != null && request.isForMainFrame()) {
                    setStatus("页面加载失败，请检查网络（校外可能需要 VPN）后重试。");
                }
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler h, SslError error) {
                /* 不忽略证书错误：直接中止并提示，避免中间人风险 */
                h.cancel();
                setStatus("证书校验未通过，已中止加载。请确认连接的是校内网络后重试。");
            }
        });
    }

    /** 每个页面加载完成后注入自动抓取脚本（脚本内部幂等，可安全重复注入） */
    private void injectAutoScript() {
        if (ustcScript == null || completed) return;
        /* 传入学期锚点（校历），供接口数据里只有起止日期时推算教学周 */
        String cfg = "";
        try {
            org.json.JSONObject term = CourseAutoSync.loadState(this).optJSONObject("term");
            if (term != null) {
                String w1s = term.optString("week1Sunday", "2026-08-30");
                int tw = term.optInt("totalWeeks", 20);
                cfg = "window.__aitodoUstcCfg={week1Sunday:" + jsonString(w1s) + ",totalWeeks:" + tw + "};";
            }
        } catch (Exception ignored) {}
        webView.evaluateJavascript(ustcScript
                + "\n;" + cfg
                + "window.__aitodoUstcReset && window.__aitodoUstcReset();"
                + "window.__aitodoUstcStart && window.__aitodoUstcStart();", null);
        android.util.Log.d("CourseSync", "auto script injected");
    }

    /* ============ 抓取触发 ============ */

    /** 手动「重新抓取」：重启自动脚本；6.5 秒无果再补注入通用 DOM 解析作兜底 */
    private void startGrab() {
        if (completed) return;
        genericInjected = false;
        btnGrab.setEnabled(false);
        setStatus("正在重新抓取（仅读取课表数据，不涉及账号密码）…");
        injectAutoScript();

        handler.postDelayed(() -> {
            if (completed || genericInjected) return;
            genericInjected = true;
            if (extractScript != null) {
                /* v1.7.7：不再向用户暴露诊断开关，诊断信息恒定按需最小化采集 */
                String boot = extractScript
                        + "\n;if (!window.__aitodoLastResult) window.__aitodoExtract(function(s){ if (!window.__aitodoLastResult) window.__aitodoLastResult = s; },{skeleton:false});";
                webView.evaluateJavascript(boot, null);
            }
        }, 6500);
    }

    /** 备份通道：每秒查一次 window.__aitodoLastResult（JavascriptInterface 失效时兜底） */
    private void startBackupPoll() {
        if (polling) return;
        polling = true;
        pollLeft = 180; // 3 分钟，与页面脚本的 2 分钟窗口对齐
        pollTask = new Runnable() {
            @Override
            public void run() {
                if (completed || webView == null) return;
                if (pollLeft-- <= 0) { polling = false; return; }
                webView.evaluateJavascript("window.__aitodoLastResult", value -> {
                    if (completed) return;
                    if (value != null && value.length() > 2 && !value.equals("null")) {
                        completeWith(unquoteJsonString(value));
                    } else {
                        handler.postDelayed(this, 1000);
                    }
                });
            }
        };
        handler.postDelayed(pollTask, 1500);
    }

    /* ============ 结果通道（MyUSTC 式主动推送） ============ */
    private class PageBridge {
        @JavascriptInterface
        public void importCourse(String payload) {
            if (payload == null || payload.isEmpty()) return; // 页面 fetch 失败会发空串，忽略，等重试/诊断
            android.util.Log.d("CourseSync", "importCourse: " + payload.length() + " chars");
            handler.post(() -> completeWith(payload));
        }

        @JavascriptInterface
        public void importStartDate(String s) {
            /* 开学日期已包含在抓取结果里，这里仅作日志 */
            android.util.Log.d("CourseSync", "importStartDate: " + s);
        }
    }

    /** 收到结果（无论来自哪个通道）：落盘备份 → 返回主界面。只生效一次。 */
    private void completeWith(String payload) {
        if (completed || payload == null || payload.isEmpty()) return;
        completed = true;
        if (pollTask != null) handler.removeCallbacks(pollTask);
        android.util.Log.d("CourseSync", "completeWith: payload=" + payload.length() + " chars");

        /* 落盘备份（getCourseRaw 兜底通道用），失败不影响主通道 */
        try (FileOutputStream fo = openFileOutput(RAW_FILE, Context.MODE_PRIVATE)) {
            fo.write(payload.getBytes("UTF-8"));
        } catch (Exception e) {
            android.util.Log.d("CourseSync", "write raw file failed: " + e.getMessage());
        }

        Toast.makeText(this, "课表已获取，正在返回应用…", Toast.LENGTH_SHORT).show();
        Intent data = new Intent();
        data.putExtra(EXTRA_RESULT, payload);
        try {
            String u = webView.getUrl();
            if (u != null && !u.isEmpty()) data.putExtra(EXTRA_GRAB_URL, u);
        } catch (Exception ignored) {}
        setResult(Activity.RESULT_OK, data);
        finish();
    }

    private void finishCancel(String reason) {
        if (completed) return;
        completed = true;
        if (pollTask != null) handler.removeCallbacks(pollTask);
        android.util.Log.d("CourseSync", "finishCancel: " + reason);
        Intent data = new Intent();
        data.putExtra(EXTRA_RESULT, "{\"ok\":false,\"error\":\"cancelled\",\"reason\":" + jsonString(reason) + "}");
        setResult(Activity.RESULT_CANCELED, data);
        finish();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        finishCancel("用户取消");
    }

    /* ============ 退出时清理 ============ */
    @Override
    protected void onDestroy() {
        try {
            if (handler != null) handler.removeCallbacksAndMessages(null);
        } catch (Exception ignored) {}
        try {
            if (webView != null) {
                webView.stopLoading();
                webView.loadUrl("about:blank");
                webView.clearHistory();
                webView.clearFormData();
                webView.clearCache(true);
                ((ViewGroup) webView.getParent()).removeView(webView);
                webView.removeAllViews();
                webView.destroy();
            }
        } catch (Exception ignored) {}
        /* 注意：这里故意不清除 Cookie —— 每日自动同步（TimetableSyncService）
         * 依赖本机 WebView 里保留的登录会话。会话不出本机、不外传；
         * 用户可在「设置 → 课表同步 → 清除本地课表数据」时通过
         * CoursePlugin.clearLogin() 一并清除。 */
        super.onDestroy();
    }

    /* ============ 小工具 ============ */
    private void setStatus(String s) {
        if (status != null) status.setText(s);
    }

    private String hostOf(String url) {
        try {
            return android.net.Uri.parse(url).getHost();
        } catch (Exception e) {
            return "";
        }
    }

    private String safeTitle(String t) {
        if (TextUtils.isEmpty(t)) return "(无标题)";
        return t.length() > 30 ? t.substring(0, 30) + "…" : t;
    }

    /** evaluateJavascript 的回调值是 JS 字符串字面量（带外层引号与转义），还原成原始 JSON 文本（供 TimetableSyncService 复用） */
    static String unquoteJsonString(String raw) {
        if (raw == null) return null;
        if (raw.length() >= 2 && raw.charAt(0) == '"' && raw.charAt(raw.length() - 1) == '"') {
            String body = raw.substring(1, raw.length() - 1);
            StringBuilder sb = new StringBuilder(body.length());
            for (int i = 0; i < body.length(); i++) {
                char c = body.charAt(i);
                if (c == '\\' && i + 1 < body.length()) {
                    char n = body.charAt(++i);
                    switch (n) {
                        case 'n': sb.append('\n'); break;
                        case 'r': sb.append('\r'); break;
                        case 't': sb.append('\t'); break;
                        case 'b': sb.append('\b'); break;
                        case 'f': sb.append('\f'); break;
                        case '"': sb.append('"'); break;
                        case '\\': sb.append('\\'); break;
                        case '/': sb.append('/'); break;
                        case 'u':
                            if (i + 4 < body.length()) {
                                try {
                                    sb.append((char) Integer.parseInt(body.substring(i + 1, i + 5), 16));
                                    i += 4;
                                } catch (Exception e) { sb.append(n); }
                            } else sb.append(n);
                            break;
                        default: sb.append(n);
                    }
                } else {
                    sb.append(c);
                }
            }
            return sb.toString();
        }
        return raw;
    }

    private static String jsonString(String s) {
        if (s == null) return "null";
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    private static String readAsset(Context ctx, String name) {
        InputStream in = null;
        try {
            in = ctx.getAssets().open(name);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), "UTF-8");
        } catch (Exception e) {
            return null;
        } finally {
            if (in != null) try { in.close(); } catch (Exception ignored) {}
        }
    }
}
