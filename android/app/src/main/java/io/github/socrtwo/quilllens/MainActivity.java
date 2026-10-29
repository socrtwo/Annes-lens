package io.github.socrtwo.quilllens;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local (non-npm) plugins must be registered before the bridge is created.
        registerPlugin(QuillNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
