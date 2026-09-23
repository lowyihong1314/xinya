import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bell,
  Copy,
  ExternalLink,
  Music4,
  Search,
} from "lucide-react";
import { useDeferredValue, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "@/shared/api/errors";
import { useApiQuery } from "@/shared/api/useApiQuery";
import { useAuth } from "@/shared/auth/AuthProvider";
import { publicUrl } from "@/shared/config/paths";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Input,
  Label,
  LoadingState,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  useConfirm,
  useToast,
} from "@/shared/ui";
// 歌本列表：接口路径写在 songbook 模块的 api.ts 里，这里直接复用那个函数，
// 不在本模块再写一遍 "/songbook/list" —— 同一条路径出现两处就会漂移。
// （它现在被两个模块用了，按架构约定该考虑上浮到 shared，见交接说明。）
import { fetchSongs, songbookKeys } from "@/features/music/songbook/api";
import type { SongEntry } from "@/features/music/songbook/types";

import {
  changyouKeys,
  fetchRoom,
  notifyRoom,
  projectPage,
  pushSong,
  updateMarker,
  type NotifyInput,
  type PushSongInput,
} from "../api";
import { ProjectionView } from "../components/ProjectionView";
import { buildProjectionPages, ensureProjectionBlocks, type ProjectionPage } from "../lib/projection";
import { useRoomCurrent } from "../lib/useRoomCurrent";
import type { RoomMutationResponse } from "../types";

/** 搜索结果一次最多渲染这么多行 —— 歌本有一百多首，全渲染进对话框会卡一下。 */
const SONG_PICKER_LIMIT = 40;

export function ChangyouRoomPage() {
  const { roomId = "" } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const [picking, setPicking] = useState(false);
  const [notify, setNotify] = useState<NotifyInput>({ kind: "text", content: "" });

  // ★ role 只有 GET /room/{id} 这一条给。**别在前端自己算「我是不是房主」** ——
  //   后端的判据是「房主 or 有 changyou_contorl 权限」，抄一份到前端就是两套规则，
  //   迟早出现「按钮亮着，点下去 403」。
  const meta = useApiQuery(changyouKeys.room(roomId), () => fetchRoom(roomId), {
    enabled: Boolean(roomId),
  });
  const { query, realtimeStatus } = useRoomCurrent(roomId);

  const entry = query.data?.entry ?? null;
  const projection = query.data?.projection ?? null;
  const canControl = meta.data?.role === "controller";

  // 整首歌切成块再按版面权重装页。控制台的「分页」列表就是它。
  const pages = useMemo(() => buildProjectionPages(entry?.content ?? ""), [entry?.content]);
  // 播放端看到的那一页。没投屏时后端给 null，播放端会退回整首歌 —— 这里跟着一样，
  // 否则控制台的预览和大屏上的不是同一个东西。
  const projectedBlocks = useMemo(
    () => ensureProjectionBlocks(projection?.blocks, projection?.content || entry?.content || ""),
    [projection?.blocks, projection?.content, entry?.content],
  );

  /**
   * 三条写操作的成功体本身就是一份完整的 current（后端用同一个函数拼的），
   * 直接写进缓存，省掉一次回源 —— 演出现场翻页的手感全靠这个。
   */
  const applyCurrent = (res: RoomMutationResponse) =>
    qc.setQueryData(changyouKeys.current(roomId), {
      room: res.room,
      entry: res.entry,
      projection: res.projection,
    });

  const fail = (fallback: string) => (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : fallback);

  const push = useMutation({
    mutationFn: (input: PushSongInput) => pushSong(roomId, input),
    onSuccess: (res) => {
      applyCurrent(res);
      setPicking(false);
      toast.success("已推到房间");
    },
    onError: fail("推歌失败"),
  });

  const project = useMutation({
    mutationFn: (page: ProjectionPage) => {
      if (!entry) throw new ApiError("房间里还没有歌", 0, null);
      return projectPage(roomId, {
        song_entry_id: entry.id,
        version_kind: entry.active_version,
        editor_user_id: entry.active_editor_user_id,
        page_index: page.index,
        page_count: pages.length,
        page_label: page.title,
        content: page.content,
        blocks: page.blocks,
        // 翻页就把高亮清掉：留着上一页的下标会高亮到新页里毫不相干的一块。
        marker_index: null,
      });
    },
    onSuccess: applyCurrent,
    onError: fail("投屏失败"),
  });

  const marker = useMutation({
    mutationFn: (index: number | null) => updateMarker(roomId, index),
    onSuccess: applyCurrent,
    onError: fail("标记失败"),
  });

  const announce = useMutation({
    mutationFn: (input: NotifyInput) => notifyRoom(roomId, input),
    onSuccess: () => {
      toast.success("通知已推给全场");
      setNotify((prev) => ({ ...prev, content: "" }));
    },
    onError: fail("推送通知失败"),
  });

  if (meta.isPending || query.isPending) return <LoadingState />;
  if (meta.isError) return <ErrorState error={meta.error} onRetry={() => void meta.refetch()} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const room = query.data.room;
  // playback_url 是后端拼的、**不带 BASE_PATH** 的裸路径（见 types.ts 的说明），
  // publicUrl 负责补前缀和 origin，而且是幂等的。
  const playbackLink = publicUrl(room.playback_url);

  async function handlePush(input: PushSongInput) {
    // 换歌会把上一首的投屏和标记一起清空（后端行为）。已经在投屏时这一步
    // 在大屏上是立刻可见、且收不回来的，所以先问一句。
    // 反过来，投屏/挪标记**不问** —— 那是演出中每分钟都在点的动作，
    // 而且下一次操作就把上一次盖掉了，加确认框只会让人手忙脚乱。
    if (projection) {
      const ok = await confirm({
        title: "换一首？",
        description: "当前投放的内容和标记会被清空，这一步不可撤销。",
        tone: "danger",
        confirmText: "换歌",
      });
      if (!ok) return;
    }
    push.mutate(input);
  }

  async function handleNotify(event: FormEvent) {
    event.preventDefault();
    const ok = await confirm({
      title: "推给全场？",
      description: "这条通知会立刻弹在所有播放端上，发出去收不回来。",
      tone: "danger",
      confirmText: "推送",
    });
    if (!ok) return;
    announce.mutate(notify);
  }

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link to="/changyou">
          <ArrowLeft />
          唱游房间
        </Link>
      </Button>

      <PageHeader
        title={room.topic}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant="neutral" className="font-mono">
              {room.room_id}
            </Badge>
            <Badge variant={canControl ? "primary" : "neutral"}>
              {canControl ? "控制台" : "观众"}
            </Badge>
            <RealtimeBadge status={realtimeStatus} />
          </span>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            {/* 播放端要开在另一块屏（投影仪）上，所以是新窗口，不是路由跳转 */}
            <a href={playbackLink} target="_blank" rel="noreferrer">
              <ExternalLink />
              播放端
            </a>
          </Button>
        }
      />

      {!canControl ? (
        <Card className="mb-4 border-info/30 bg-info-soft">
          <CardContent className="pt-5 text-sm text-info">
            你在这个房间是观众，只能看。要控制房间得是房主，或者有 changyou_contorl 权限。
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <CardTitle className="truncate">
                  {entry ? `${entry.song_number ? `${entry.song_number}. ` : ""}${entry.title}` : "还没有推歌"}
                </CardTitle>
                <CardDescription>
                  {entry
                    ? `${entry.active_version_label}${projection?.page_label ? ` · 正在投「${projection.page_label}」` : " · 播放端显示整首"}`
                    : "选一首歌推到房间，播放端会跟着刷新"}
                </CardDescription>
              </div>
              {canControl ? (
                <Button size="sm" onClick={() => setPicking(true)}>
                  <Music4 />
                  {entry ? "换歌" : "推歌"}
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              <ProjectionView
                blocks={projectedBlocks}
                markerIndex={projection?.marker_index ?? null}
                onSelectBlock={canControl ? (index) => marker.mutate(index) : undefined}
              />
              {canControl && projectedBlocks.length ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  点一段歌词 = 把大屏上的高亮挪过去，再点一次取消。
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {canControl && entry ? (
            <Card>
              <CardHeader>
                <CardTitle>分页投屏</CardTitle>
                <CardDescription>
                  按版面自动切成 {pages.length} 页，点一页投到大屏
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {pages.map((page) => {
                  // 「这页正在投吗」只能靠页码认 —— 后端存的是内容，不是页 id。
                  // 页数对不上（歌换过、分页规则改过）时一律当成没在投，
                  // 宁可多投一次，也不要在大屏上标错页。
                  const active =
                    projection?.page_count === pages.length && projection.page_index === page.index;
                  return (
                    <Button
                      key={page.index}
                      variant={active ? "primary" : "outline"}
                      className="w-full justify-start"
                      loading={project.isPending && project.variables?.index === page.index}
                      onClick={() => project.mutate(page)}
                    >
                      <span className="w-8 shrink-0 text-left font-mono text-sm opacity-70">
                        {page.index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-left">{page.title}</span>
                    </Button>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          {canControl ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="size-4" aria-hidden />
                  全场通知
                </CardTitle>
                <CardDescription>
                  弹在所有播放端上。不保存 —— 后进来的人和刷新过的人看不到。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleNotify} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="notify-kind">类型</Label>
                    <Select
                      id="notify-kind"
                      value={notify.kind}
                      onChange={(e) =>
                        setNotify({ ...notify, kind: e.target.value as NotifyInput["kind"] })
                      }
                    >
                      <option value="text">一行字</option>
                      <option value="qr">二维码（填链接）</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="notify-content">内容</Label>
                    <Textarea
                      id="notify-content"
                      required
                      // 上限和后端一致（text 140 / qr 1200）。后端是**截断**不是报错，
                      // 这里拦在前面只是让人当场看到写不下了。
                      maxLength={notify.kind === "qr" ? 1200 : 140}
                      className="min-h-20"
                      value={notify.content}
                      onChange={(e) => setNotify({ ...notify, content: e.target.value })}
                      placeholder={notify.kind === "qr" ? "https://…" : "例如：下一首请翻到第 12 页"}
                    />
                  </div>
                  <Button type="submit" className="w-full" loading={announce.isPending}>
                    推给全场
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>播放端地址</CardTitle>
              <CardDescription>现场大屏和观众手机打开这个地址</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="break-all rounded-[var(--radius-sm)] bg-muted px-3 py-2 font-mono text-sm">
                {playbackLink}
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={async () => {
                  // clipboard 在非 https 的页面上直接是 undefined，不是抛异常 ——
                  // 不先判一下的话会「提示复制成功但什么都没复制」。
                  if (!navigator.clipboard) {
                    toast.error("这个浏览器不让脚本复制，请长按地址手动复制");
                    return;
                  }
                  try {
                    await navigator.clipboard.writeText(playbackLink);
                    toast.success("地址已复制");
                  } catch {
                    toast.error("复制失败，请长按地址手动复制");
                  }
                }}
              >
                <Copy />
                复制地址
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <SongPickerDialog
        open={picking}
        onOpenChange={setPicking}
        currentUserId={user?.id ?? null}
        submitting={push.isPending}
        onPick={handlePush}
      />
    </div>
  );
}

/**
 * 实时通道状态。
 * 后端还没给 changyou_room 注册 SSE，所以现在**正常情况就是 closed** ——
 * 这个标签的意义是让现场操作的人知道「大屏不是即时跟着的，有几秒延迟」，
 * 而不是让他以为自己网断了。
 */
function RealtimeBadge({ status }: { status: "connecting" | "open" | "closed" }) {
  if (status === "open") return <Badge variant="success">实时已连接</Badge>;
  if (status === "connecting") return <Badge variant="warning">连接中…</Badge>;
  return <Badge variant="neutral">轮询中（每 3 秒）</Badge>;
}

function SongPickerDialog({
  open,
  onOpenChange,
  currentUserId,
  submitting,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 推「我的编辑版」时要把自己的 id 发给后端，它按 (歌, 人) 找那一份覆盖。 */
  currentUserId: number | null;
  submitting: boolean;
  onPick: (input: PushSongInput) => void;
}) {
  const [keyword, setKeyword] = useState("");
  // 输入时不要每敲一个字就发一次请求。useDeferredValue 让输入框保持跟手，
  // 查询用滞后的值 —— 比 debounce 好在不用管定时器的清理。
  const deferred = useDeferredValue(keyword);

  const list = useApiQuery(
    songbookKeys.list({ q: deferred }),
    () => fetchSongs({ q: deferred }),
    { enabled: open, placeholderData: (prev) => prev },
  );

  const shown = list.data?.entries.slice(0, SONG_PICKER_LIMIT) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>选一首推到房间</DialogTitle>
        </DialogHeader>

        <div className="relative mb-3">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索歌名"
            className="pl-9"
            aria-label="搜索歌名"
          />
        </div>

        {list.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : shown.length ? (
          <ul className="space-y-1.5">
            {shown.map((song) => (
              <SongRow
                key={song.id}
                song={song}
                currentUserId={currentUserId}
                submitting={submitting}
                onPick={onPick}
              />
            ))}
            {(list.data?.entries.length ?? 0) > shown.length ? (
              <li className="pt-1 text-center text-sm text-muted-foreground">
                只显示前 {SONG_PICKER_LIMIT} 首，用搜索缩小范围
              </li>
            ) : null}
          </ul>
        ) : (
          <EmptyState title="没有匹配的歌" description="试试别的关键词" />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SongRow({
  song,
  currentUserId,
  submitting,
  onPick,
}: {
  song: SongEntry;
  currentUserId: number | null;
  submitting: boolean;
  onPick: (input: PushSongInput) => void;
}) {
  // 「我的版本」只有在我自己改过这首歌、而且知道我是谁的时候才推得动 ——
  // 后端按 (base_entry_id, user_id) 找覆盖，找不到会静默回落到原版。
  const canPushMine = song.has_user_override && currentUserId !== null;

  return (
    <li className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-border p-2">
      <span className="w-8 shrink-0 text-right font-mono text-sm text-muted-foreground">
        {song.song_number ?? "—"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{song.title}</span>
        {song.variant ? (
          <span className="text-sm text-muted-foreground">{song.variant}</span>
        ) : null}
      </span>
      {canPushMine ? (
        <Button
          size="sm"
          variant="outline"
          disabled={submitting}
          onClick={() =>
            onPick({ song_entry_id: song.id, version_kind: "user", editor_user_id: currentUserId })
          }
        >
          我的版本
        </Button>
      ) : null}
      <Button
        size="sm"
        disabled={submitting}
        onClick={() => onPick({ song_entry_id: song.id, version_kind: "base", editor_user_id: null })}
      >
        推原版
      </Button>
    </li>
  );
}
