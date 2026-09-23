/**
 * SSE 订阅的 React 封装。
 *
 * 直接用 subscribeRealtime 也行，但在组件里用它有两个坑：
 *   ① handlers 每次渲染都是新对象 → useEffect 依赖变化 → 反复重连；
 *   ② 组件卸载时忘了退订 → 连接泄漏，很快撞上浏览器 6 连接上限。
 * 这个 hook 把 handlers 存 ref、只在 app/rooms 真正变化时重连、卸载自动退订。
 */
import { useEffect, useRef, useState } from "react";

import {
  subscribeRealtime,
  type RealtimeHandlers,
  type RealtimeOptions,
  type RealtimeStatus,
} from "./client";

export function useRealtime(
  app: string | null,
  rooms: readonly string[],
  handlers: RealtimeHandlers,
  options?: RealtimeOptions,
): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>("connecting");

  // handlers 每次渲染都是新对象；存 ref 后 effect 的依赖里就不用带它，
  // 否则每渲染一次就断开重连一次（症状：消息断断续续、服务端连接数暴涨）。
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // 房间数组同理：按**内容**而不是引用参与依赖。
  const roomsKey = rooms.join("\u0000");

  useEffect(() => {
    if (!app || rooms.length === 0) return;

    const proxied: RealtimeHandlers = {};
    for (const event of Object.keys(handlersRef.current)) {
      proxied[event] = (msg) => handlersRef.current[event]?.(msg);
    }

    const unsubscribe = subscribeRealtime(app, roomsKey.split("\u0000"), proxied, {
      ...optionsRef.current,
      onStatus: (info) => {
        setStatus(info.status);
        optionsRef.current?.onStatus?.(info);
      },
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, roomsKey]);

  return status;
}
