package com.xinya.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeMusicPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
