import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.xinya.app",
  appName: "心芽",
  // Points to the APK build output (npm run build:apk)
  webDir: "apk_dist",
  server: {
    // Allow cleartext traffic so WebSocket / HLS streams work without extra Android config
    cleartext: false,
    // Cookie-based sessions need credentials forwarded
    androidScheme: "https",
  },
};

export default config;
