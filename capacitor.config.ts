import type { CapacitorConfig } from '@capacitor/cli';

// Anne's Lens: Capacitor configuration shared by the Android and iOS projects.
// `npx cap sync` copies dist/ (the Vite build) into each native project and regenerates the
// plugin lists; the native projects themselves are committed.
const config: CapacitorConfig = {
  appId: 'io.github.socrtwo.quilllens',
  appName: "Anne's Lens",
  webDir: 'dist',
  server: {
    // https://localhost so that web APIs gated on secure contexts (clipboard, file handling,
    // ImageDecoder, service worker) work inside the WebView.
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
  android: {
    allowMixedContent: false,
    // The web app is bundled; the WebView never needs to show a navigation bar or zoom controls.
    webContentsDebuggingEnabled: false,
  },
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
  },
};

export default config;
