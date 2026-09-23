/**
 * go2rtc 的 VideoRTC 组件（同目录 video-rtc.js，上游 v1.6.0 原样搬来）的类型声明。
 *
 * 只声明**我们真正用到的**成员：上游还有几十个字段和方法，全抄一遍迟早和 js 漂移，
 * 而漂移的方向恰好是「类型说有、运行时没有」。
 *
 * 文件名必须和 .js 同名：`import { VideoRTC } from "./video-rtc.js"` 时
 * TypeScript 会按 .js → .d.ts 的替换规则找到这里，运行时 Vite 仍然加载 .js。
 */
export declare class VideoRTC extends HTMLElement {
  /**
   * 播放模式，逗号分隔的优先级列表：webrtc / webrtc/tcp / mse / hls / mp4 / mjpeg。
   * 默认 "webrtc,mse,hls,mjpeg"。
   */
  mode: string;

  /** 不在视口内时是否继续拉流。默认 false（切走就停，省电省带宽）。 */
  background: boolean;

  /**
   * 信令 WebSocket 地址。上游是个 setter：**赋值即开始连接**（里面直接调 onconnect）。
   * 这里声明成普通属性，因为只写不读的 accessor 用 Pick<> 取出来会报错。
   */
  src: string;

  /**
   * 真正断开：关 WebSocket、关 PeerConnection、清空内部 <video>。
   * ★ 想重连必须先调它 —— onconnect() 开头是 `if (this.ws) return`，
   *   不先断开的话重新赋 src 会被静默忽略。
   */
  ondisconnect(): void;
}
