import type { CapacitorConfig } from "@capacitor/cli";

const androidScheme = process.env.CAP_ANDROID_SCHEME ?? "https";
const allowCleartext = process.env.CAP_CLEARTEXT === "true";

const config: CapacitorConfig = {
  appId: "com.utba.app",
  appName: "UTBA",
  // Points to the APK build output (npm run build:apk)
  webDir: "apk_dist",
  server: {
    // Local emulator builds can opt into http + cleartext so the WebView can reach
    // the Flask dev server on 10.0.2.2 without mixed-content blocking.
    cleartext: allowCleartext,
    // Production APKs keep https://localhost for secure cookie-based sessions.
    androidScheme,
  },
};

export default config;
