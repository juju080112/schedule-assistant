package com.aitodo.app;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(BarPlugin.class);
    registerPlugin(CoursePlugin.class);
    registerPlugin(SystemPlugin.class);
    super.onCreate(savedInstanceState);
    maybeExportDiag();
  }

  /** v1.7.1：把登录窗口的结果直接转发给 CoursePlugin（静态回传，不依赖 Capacitor 调度） */
  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode == CoursePlugin.REQ_LOGIN) {
      CoursePlugin.onLoginResult(resultCode, data);
    }
  }

  /** v1.9.5：已在运行时再次收到 Intent 也要能触发导出 */
  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    maybeExportDiag();
  }

  /**
   * v1.9.5 维护入口：用 adb 直接触发「导出课表诊断」，不必在设置界面里点按钮
   * （设置子页会记住上次打开的位置，脚本盲点容易误触「清除本地课表数据」）。
   *
   *   adb shell am start -a com.aitodo.app.EXPORT_DIAG -n com.aitodo.app/.MainActivity
   *
   * 导出文件落在 /sdcard/Android/data/com.aitodo.app/files/，adb 可直接 pull。
   */
  private void maybeExportDiag() {
    Intent it = getIntent();
    if (it == null) return;
    String action = it.getAction();
    String data = it.getData() == null ? null : it.getData().toString();
    boolean want = "com.aitodo.app.EXPORT_DIAG".equals(action)
            || (data != null && data.startsWith("aitodo://export-diag"));
    if (!want) return;
    new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
      @Override
      public void run() {
        CoursePlugin.requestExport();
      }
    }, 1500);
  }
}
