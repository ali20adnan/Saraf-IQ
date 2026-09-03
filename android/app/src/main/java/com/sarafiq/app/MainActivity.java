package com.sarafiq.app;

import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

/**
 * ضبط WebView لأداء أفضل على أجهزة حديثة (مثل 120Hz) — تمرير وأولوية الرندر.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onResume() {
        super.onResume();
        new Handler(Looper.getMainLooper()).post(this::tuneWebViewForScroll);
    }

    private void tuneWebViewForScroll() {
        try {
            if (getBridge() == null) {
                return;
            }
            WebView wv = getBridge().getWebView();
            if (wv == null) {
                return;
            }
            wv.setLayerType(View.LAYER_TYPE_HARDWARE, null);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                wv.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_YES);
            }
            WebSettings s = wv.getSettings();
            s.setCacheMode(WebSettings.LOAD_DEFAULT);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                wv.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true);
            }
        } catch (Throwable ignored) {
            // تجاهل على أجهزة/WebView نادرة التوافق
        }
    }
}
