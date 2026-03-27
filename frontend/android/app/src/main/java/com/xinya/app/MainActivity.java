package com.xinya.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeMusicPlugin.class);
        registerPlugin(NativeMediaCachePlugin.class);
        registerPlugin(NativeResponseCachePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
