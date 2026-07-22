// Registers the go2rtc VideoRTC web component as <video-rtc-cctv>.
// Import for side effect before using the element.
import { VideoRTC } from "./video-rtc.js";
import type { CSSProperties, Ref } from "react";

export const VIDEO_RTC_TAG = "video-rtc-cctv";

if (typeof window !== "undefined" && !customElements.get(VIDEO_RTC_TAG)) {
  customElements.define(VIDEO_RTC_TAG, class extends VideoRTC {});
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "video-rtc-cctv": {
        ref?: Ref<HTMLElement>;
        style?: CSSProperties;
      };
    }
  }
}
