package com.aitodo.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(BarPlugin.class);
    registerPlugin(CoursePlugin.class);
    registerPlugin(SystemPlugin.class);
    super.onCreate(savedInstanceState);
  }

  /** v1.7.1：把登录窗口的结果直接转发给 CoursePlugin（静态回传，不依赖 Capacitor 调度） */
  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode == CoursePlugin.REQ_LOGIN) {
      CoursePlugin.onLoginResult(resultCode, data);
    }
  }
}
