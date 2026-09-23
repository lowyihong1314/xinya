/**
 * 把 go2rtc 的 VideoRTC 注册成自定义元素 `<video-rtc-cctv>`，并补上 JSX 类型。
 *
 * 用之前要 import 本文件（副作用导入）—— 没注册的话浏览器会把这个标签当成
 * 未知元素渲染成空的 inline 盒子，表现是「播放器那块什么都没有，控制台也不报错」。
 */
import { VideoRTC } from "./video-rtc.js";

export const VIDEO_RTC_TAG = "video-rtc-cctv";

/** 我们在页面里操作的那几个成员。ref 用它，不要用裸 HTMLElement。 */
export type VideoRtcElement = HTMLElement & Pick<VideoRTC, "mode" | "background" | "src" | "ondisconnect">;

// customElements.define 同名注册两次会抛异常（热更新 / 两个页面都 import 时会发生）。
if (typeof window !== "undefined" && !customElements.get(VIDEO_RTC_TAG)) {
  customElements.define(VIDEO_RTC_TAG, class extends VideoRTC {});
}

// 模块增强里的名字是在 react 自己的作用域里解析的（HTMLAttributes / Ref 都来自那边），
// 所以这里**不要**再 import 它们 —— 导入了反而会被判成「未使用」。
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "video-rtc-cctv": HTMLAttributes<HTMLElement> & { ref?: Ref<VideoRtcElement> };
    }
  }
}
