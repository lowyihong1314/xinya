import { IS_APK } from "../../js/apiBase";
import { clearAllNativeMediaCache } from "../../js/nativeMediaCache";
import { clearAllNativeResponseCache } from "../../js/nativeResponseCache";
import { NativeAuthPluginBridge } from "./authPlugin";
import { NativeMusicPluginBridge } from "./musicPlugin";

export async function clearMobileNativeSessionState() {
  const tasks: Array<{ label: string; run: () => Promise<unknown> }> = [
    { label: "NativeAuth.clearSession", run: () => NativeAuthPluginBridge.clearSession() },
    { label: "NativeResponseCache.clearAll", run: clearAllNativeResponseCache },
    { label: "NativeMediaCache.clearAll", run: clearAllNativeMediaCache },
  ];

  if (IS_APK) {
    tasks.push({
      label: "NativeMusic.clearQueue",
      run: () => NativeMusicPluginBridge.clearQueue(),
    });
  }

  const results = await Promise.allSettled(tasks.map((task) => task.run()));
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.warn(`${tasks[index].label} failed:`, result.reason);
    }
  });
}
