import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  ErrorState,
  LoadingState,
  PageHeader,
  Select,
} from "@/shared/ui";
import { ProjectionView } from "../components/ProjectionView";
import { ensureProjectionBlocks } from "../lib/projection";
import { useRoomCurrent } from "../lib/useRoomCurrent";

/**
 * 播放端：现场大屏 / 观众手机扫码打开的那一页。
 *
 * ★ **公开页，不要求登录**（后端 /room/{id}/current 故意没有 login_required）。
 *   房间号是 8 位随机串 + 24 小时 TTL，这就是它全部的「鉴权」。
 *   路由要挂在 PublicLayout 下面，套上 RequireAuth 当场就是演出事故：
 *   所有观众得先登录才能看歌词。
 *
 * ★ 地址是 /changyou-room/:roomId，和后端 serialize_room 发出去的 playback_url
 *   一致 —— 已经印成二维码发出去的链接得继续能打开。
 */

/** 字号档位。大屏和手机差得太远，必须能当场调。 */
const SCALES = {
  small: { label: "小", className: "text-base leading-8" },
  medium: { label: "中", className: "text-2xl leading-10" },
  large: { label: "大", className: "text-4xl leading-snug" },
} as const;

type ScaleKey = keyof typeof SCALES;

const SCALE_STORAGE_KEY = "xinya.changyou.playerScale";

function isScaleKey(value: unknown): value is ScaleKey {
  return value === "small" || value === "medium" || value === "large";
}

/**
 * 字号是**每台设备自己的习惯**（大屏永远要大、手机要小），不是房间状态，
 * 所以存在本地而不是发给后端。
 * localStorage 在隐私窗口、禁了站点数据的浏览器里会直接抛，所以读写都包 try。
 */
function readStoredScale(): ScaleKey {
  try {
    const stored = window.localStorage.getItem(SCALE_STORAGE_KEY);
    if (isScaleKey(stored)) return stored;
  } catch {
    // 读不到就用默认值，不是错误
  }
  return "medium";
}

export function ChangyouPlayerPage() {
  const { roomId = "" } = useParams();
  const { query, realtimeStatus, notification, dismissNotification } = useRoomCurrent(roomId);
  const [scale, setScale] = useState<ScaleKey>(readStoredScale);

  useEffect(() => {
    try {
      window.localStorage.setItem(SCALE_STORAGE_KEY, scale);
    } catch {
      // 存不下就算了，下次打开退回默认档
    }
  }, [scale]);

  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const { room, entry, projection } = query.data;
  // 没投屏时退回整首歌 —— 和控制台的预览走同一个函数，两边显示的必须一样。
  const blocks = ensureProjectionBlocks(projection?.blocks, projection?.content || entry?.content || "");

  return (
    <div className="mx-auto w-full max-w-5xl py-4">
      <PageHeader
        title={entry ? entry.title : room.topic}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <span>{room.topic}</span>
            {entry ? <Badge variant="neutral">{entry.active_version_label}</Badge> : null}
            {projection?.page_label ? (
              <Badge variant="primary">
                {projection.page_label}
                {projection.page_count > 1
                  ? ` · ${projection.page_index + 1}/${projection.page_count}`
                  : ""}
              </Badge>
            ) : null}
            {realtimeStatus === "open" ? (
              <Badge variant="success">实时</Badge>
            ) : (
              <Badge variant="neutral">每 3 秒刷新</Badge>
            )}
          </span>
        }
        actions={
          <div className="w-24">
            <Select
              value={scale}
              onChange={(e) => setScale(isScaleKey(e.target.value) ? e.target.value : "medium")}
              aria-label="字号"
            >
              {Object.entries(SCALES).map(([key, cfg]) => (
                <option key={key} value={key}>
                  {cfg.label}字
                </option>
              ))}
            </Select>
          </div>
        }
      />

      <Card>
        <CardContent className="pt-5">
          <ProjectionView
            blocks={blocks}
            markerIndex={projection?.marker_index ?? null}
            autoScroll
            textClassName={SCALES[scale].className}
          />
        </CardContent>
      </Card>

      <NotificationDialog notification={notification} onDismiss={dismissNotification} />
    </div>
  );
}

/**
 * 全场通知。
 *
 * ★ 通知是**纯广播、不落 Redis**，只从 SSE 来。后端现在还没给 changyou_room
 *   注册实时通道（GET /changyou_room/realtime 是 404），所以**这个弹窗当前
 *   永远不会出现** —— 不是写坏了，是链路还没通。等后端补上 register 就自然活了。
 */
function NotificationDialog({
  notification,
  onDismiss,
}: {
  notification: { kind: "text" | "qr"; content: string } | null;
  onDismiss: () => void;
}) {
  return (
    <Dialog open={notification !== null} onOpenChange={(open) => (open ? undefined : onDismiss())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>全场通知</DialogTitle>
        </DialogHeader>
        {notification?.kind === "qr" ? (
          // TODO: 缺一个公共的二维码组件（@/shared/ui 里没有），所以这里先把
          // 链接原样显示出来让人自己点/自己扫。不在本模块造一个私有的 QR 组件 ——
          // 那样同一个东西会在几个模块里各长一个样。见交接说明里的 blockers。
          <a
            href={notification.content}
            target="_blank"
            rel="noreferrer"
            className="block break-all text-lg text-primary underline underline-offset-4"
          >
            {notification.content}
          </a>
        ) : (
          <p className="text-xl leading-relaxed">{notification?.content}</p>
        )}
        <div className="mt-5 flex justify-end">
          <Button onClick={onDismiss}>知道了</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
