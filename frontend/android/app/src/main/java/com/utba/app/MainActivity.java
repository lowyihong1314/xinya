package com.utba.app;

import android.os.Bundle;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        registerPlugin(NativeMusicPlugin.class);
        registerPlugin(NativeMediaCachePlugin.class);
        registerPlugin(NativeResponseCachePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
