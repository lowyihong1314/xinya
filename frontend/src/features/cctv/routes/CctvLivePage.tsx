import { useMutation } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  RefreshCw,
  Square,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";

import { ApiError } from "@/shared/api/errors";
import { Badge, Button, PageHeader, useToast } from "@/shared/ui";
import { CAMERA_SRC, ptzMove, ptzStop, streamWsUrl, type PtzVector } from "../api";
import { PlayerFrame } from "../components/PlayerFrame";
import { ViewSwitch } from "../components/ViewSwitch";
import type { VideoRtcElement } from "../vendor/videoRtcElement";
// 副作用导入：注册 <video-rtc-cctv>。删了它标签还在，但浏览器把它当未知元素，
// 播放器那块会一片空白且不报错。
import "../vendor/videoRtcElement";

/** 云台速度（−1 ~ 1）。0.4 是旧版用了很久的手感，别随手调。 */
const PTZ_SPEED = 0.4;

type PtzCommand = PtzVector | "stop";
type StreamStatus = "connecting" | "live" | "error";

export function CctvLivePage() {
  const toast = useToast();
  const elRef = useRef<VideoRtcElement | null>(null);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  // 换这个值 = 重新连一次流（effect 会先断干净再连）。
  const [reconnectKey, setReconnectKey] = useState(0);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    setStatus("connecting");
    el.background = false;   // 切走页面就停，别在后台一直拉流（手机上很费电）
    el.mode = "webrtc";      // 原始 H264 直连，不转码：摄像头关键帧间隔很长，MSE 会等很久才出画面
    el.src = streamWsUrl();

    // playing / waiting / error 这三个事件**不冒泡**，但捕获阶段照样会经过祖先节点，
    // 所以在自定义元素上挂捕获监听就能收到它内部那个 <video> 的事件 ——
    // 不用像旧版那样 requestAnimationFrame 轮询等 el.video 出现。
    const onPlaying = () => setStatus("live");
    const onWaiting = () => setStatus((s) => (s === "live" ? s : "connecting"));
    const onError = () => setStatus("error");
    el.addEventListener("playing", onPlaying, true);
    el.addEventListener("waiting", onWaiting, true);
    el.addEventListener("error", onError, true);

    return () => {
      el.removeEventListener("playing", onPlaying, true);
      el.removeEventListener("waiting", onWaiting, true);
      el.removeEventListener("error", onError, true);
      // ★ 必须调 ondisconnect() 而不是 `el.src = ""`：上游 onconnect() 开头是
      //   `if (this.ws) return`，不真断开的话下一次赋 src 会被静默忽略 ——
      //   症状是「点了重连没反应」。
      el.ondisconnect();
    };
  }, [reconnectKey]);

  // 同一条错误在上一条还没消失时不再弹一遍：按一下方向键是「移动 + 停止」两条请求，
  // 摄像头连不上时两条都失败，不去重就是一次按键弹两个一模一样的提示。
  // 6 秒 = toast.tsx 里 error 的停留时间。
  const lastError = useRef({ message: "", at: 0 });
  const reportPtzError = useCallback(
    (err: unknown) => {
      const message = err instanceof ApiError ? err.message : "云台指令失败";
      const now = Date.now();
      if (message === lastError.current.message && now - lastError.current.at < 6000) return;
      lastError.current = { message, at: now };
      toast.error(message);
    },
    [toast],
  );

  // 移动和停止合成一条 mutation：它们是同一个通道、失败原因也一样
  // （连不上摄像头 / dev 机没填 CAM_USER），分成两条只会让上面那段去重逻辑写两遍。
  const { mutate: sendPtz } = useMutation({
    mutationFn: (cmd: PtzCommand) => (cmd === "stop" ? ptzStop() : ptzMove(cmd)),
    onError: reportPtzError,
  });

  // 键盘云台：方向键移动、+/− 变焦，松开即停。
  useEffect(() => {
    const KEYMAP: Record<string, PtzVector> = {
      ArrowUp: { y: PTZ_SPEED },
      ArrowDown: { y: -PTZ_SPEED },
      ArrowLeft: { x: -PTZ_SPEED },
      ArrowRight: { x: PTZ_SPEED },
      "+": { z: PTZ_SPEED },
      "=": { z: PTZ_SPEED },   // 免 Shift 的 +
      "-": { z: -PTZ_SPEED },
    };
    const pressed = new Set<string>();

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // 在输入框里按方向键是移动光标，不是转镜头。
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const vector = KEYMAP[e.key];
      if (!vector) return;
      e.preventDefault();          // 方向键默认会滚页面
      if (pressed.has(e.key)) return;  // 忽略按住不放的 auto-repeat，否则每秒发几十条
      pressed.add(e.key);
      sendPtz(vector);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!pressed.delete(e.key)) return;
      if (pressed.size === 0) sendPtz("stop");
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      // 切页面时手还按着 → 补一条停止，否则镜头要转到后端那个 100 秒兜底定时器才停。
      if (pressed.size > 0) sendPtz("stop");
    };
  }, [sendPtz]);

  const press = (vector: PtzVector) => () => sendPtz(vector);
  const release = () => sendPtz("stop");

  return (
    <div>
      <PageHeader
        title="监控"
        description={`${CAMERA_SRC} · 实时画面`}
        actions={<ViewSwitch current="live" />}
      />

      <PlayerFrame
        badge={<StatusBadge status={status} />}
        actions={
          status === "error" ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/15 hover:text-white"
              onClick={() => setReconnectKey((k) => k + 1)}
            >
              <RefreshCw />
              重连
            </Button>
          ) : null
        }
      >
        <video-rtc-cctv ref={elRef} className="absolute inset-0 size-full" />

        {status === "error" ? (
          // 这里不用 ErrorState：它的文字是 text-foreground（浅色主题下是深墨色），
          // 压在黑色画面上看不见；而且这不是取数失败，是流断了，重试的是 WebSocket。
          <p className="absolute inset-x-6 top-1/2 -translate-y-1/2 text-center text-sm text-white">
            连不上直播流。点右上角「重连」；一直失败就是转流服务（go2rtc）没起来。
          </p>
        ) : null}

        <PtzPad onPress={press} onRelease={release} />
      </PlayerFrame>

      <p className="mt-3 text-sm text-muted-foreground">
        按住方向键或画面右下角的摇杆移动镜头，+ / − 变焦，松开即停。
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: StreamStatus }) {
  if (status === "live") return <Badge variant="success">● 直播中</Badge>;
  if (status === "error") return <Badge variant="danger">连接失败</Badge>;
  return <Badge variant="neutral">连接中…</Badge>;
}

/** 云台摇杆：画面右下角的变焦条 + 方向键。 */
function PtzPad({
  onPress,
  onRelease,
}: {
  onPress: (vector: PtzVector) => () => void;
  onRelease: () => void;
}) {
  return (
    <div className="absolute right-3 bottom-14 flex items-center gap-2">
      <div className="flex flex-col gap-1 rounded-[var(--radius-sm)] bg-black/55 p-1.5 backdrop-blur-sm">
        <PtzButton label="放大" icon={ZoomIn} onPress={onPress({ z: PTZ_SPEED })} onRelease={onRelease} />
        <PtzButton label="缩小" icon={ZoomOut} onPress={onPress({ z: -PTZ_SPEED })} onRelease={onRelease} />
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-[var(--radius-sm)] bg-black/55 p-1.5 backdrop-blur-sm">
        <span />
        <PtzButton label="向上" icon={ChevronUp} onPress={onPress({ y: PTZ_SPEED })} onRelease={onRelease} />
        <span />
        <PtzButton label="向左" icon={ChevronLeft} onPress={onPress({ x: -PTZ_SPEED })} onRelease={onRelease} />
        {/* 兜底的「停」：手势没被识别到、或者松手事件丢了的时候点它。 */}
        <PtzButton label="停止" icon={Square} onPress={onRelease} onRelease={onRelease} />
        <PtzButton label="向右" icon={ChevronRight} onPress={onPress({ x: PTZ_SPEED })} onRelease={onRelease} />
        <span />
        <PtzButton label="向下" icon={ChevronDown} onPress={onPress({ y: -PTZ_SPEED })} onRelease={onRelease} />
        <span />
      </div>
    </div>
  );
}

function PtzButton({
  label,
  icon: Icon,
  onPress,
  onRelease,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  onPress: () => void;
  onRelease: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-11 touch-none rounded-[var(--radius-sm)] bg-white/10 text-white hover:bg-white/25 hover:text-white"
      aria-label={label}
      title={label}
      // 指针事件一套通吃鼠标和触屏（旧版是 mouse* 和 touch* 各写一遍）。
      // setPointerCapture：手指/鼠标按下后滑出按钮，抬起事件照样回到这里 ——
      // 不捕获的话「滑出去再松手」会漏掉停止指令，镜头继续转。
      onPointerDown={(e) => {
        e.preventDefault();  // 别把按住当成选中文字 / 触发滚动
        e.currentTarget.setPointerCapture(e.pointerId);
        onPress();
      }}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
      // 焦点在按钮上时 Enter / 空格只会产生 click，不会走 pointer 那条路 ——
      // 不接这两个键的话，Tab 过来的键盘用户按下去没有任何反应。
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();      // 空格默认滚页面，而且松手时会补一个 click
        if (!e.repeat) onPress(); // 按住不放的连发只当一次
      }}
      onKeyUp={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        onRelease();
      }}
    >
      <Icon />
    </Button>
  );
}
