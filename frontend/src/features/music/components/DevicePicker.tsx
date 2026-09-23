import { Check, Laptop, Loader2, Smartphone, Speaker } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/shared/api/errors";
import { cn } from "@/shared/lib/cn";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  useToast,
} from "@/shared/ui";
import type { PlaybackDevice } from "./usePlaybackDevices";

/**
 * 「在哪台设备上播放」下拉（Spotify Connect 那个喇叭图标）。
 *
 * 后端规则是**同一时刻只有一个设备能放**。这里选一台 → 播放权转过去 →
 * 服务端广播 → 其余设备（包括本机）收到后自己停下来。
 */
export function DevicePicker({
  devices,
  activeId,
  myConnectionId,
  connected,
  onClaim,
}: {
  devices: PlaybackDevice[];
  activeId: string | null;
  myConnectionId: string | null;
  /** SSE 是否连着。断线时禁用切换 —— 切了也传不出去。 */
  connected: boolean;
  onClaim: (connectionId: string) => Promise<void>;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const activeDevice = devices.find((d) => d.connection_id === activeId) ?? null;
  const playingHere = activeId != null && activeId === myConnectionId;

  async function pick(device: PlaybackDevice) {
    if (device.connection_id === activeId) {
      setOpen(false);
      return;
    }
    setBusy(device.connection_id);
    try {
      await onClaim(device.connection_id);
      toast.success(`已转到「${device.name}」`);
      setOpen(false);
    } catch (err) {
      // 409 device_gone：那台在我们点之间掉线了。提示 + 留在弹窗里，
      // 列表会被服务端的广播刷新，用户可以直接换一台。
      toast.error(err instanceof ApiError ? err.message : "切换失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        disabled={!connected}
        aria-label="选择播放设备"
        title={
          connected
            ? playingHere
              ? "正在这台设备上播放"
              : `正在「${activeDevice?.name ?? "其他设备"}」上播放`
            : "未连接"
        }
        className={cn(!playingHere && connected && "text-primary")}
      >
        <Speaker />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>在哪里播放</DialogTitle>
            <DialogDescription>
              同一时刻只有一台设备能播放，选择后会自动从其他设备切过来。
            </DialogDescription>
          </DialogHeader>

          {devices.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">没有其他在线设备</p>
          ) : (
            <ul className="-mx-1 space-y-0.5 px-1">
              {devices.map((d) => {
                const isMe = d.connection_id === myConnectionId;
                const isActive = d.connection_id === activeId;
                const Icon = d.kind === "apk" ? Smartphone : Laptop;
                return (
                  <li key={d.connection_id}>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void pick(d)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-left transition-colors",
                        isActive ? "bg-primary-soft text-primary-strong" : "hover:bg-accent",
                        busy !== null && "opacity-60",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{d.name}</span>
                        {/* 标出「就是你正在看的这台」—— 两台同型号浏览器时这是唯一的区分 */}
                        {isMe ? (
                          <span className="block text-xs text-muted-foreground">这台设备</span>
                        ) : null}
                      </span>
                      {busy === d.connection_id ? (
                        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                      ) : isActive ? (
                        <Check className="size-4 shrink-0" aria-hidden />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
