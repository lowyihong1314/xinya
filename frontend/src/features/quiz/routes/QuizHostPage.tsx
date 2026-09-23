import { useMutation } from "@tanstack/react-query";
import { Copy, Plus, RotateCcw, Save, Send, Square, Users } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/shared/api/errors";
import { publicUrl } from "@/shared/config/paths";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Input,
  Label,
  LoadingState,
  PageHeader,
  useConfirm,
  useToast,
} from "@/shared/ui";

import {
  closeQuizSession,
  createQuizSession,
  publishQuizSession,
  quizErrorReason,
  resetQuizSession,
  saveQuizConfig,
} from "../api";
import { QuizCountdown } from "../components/QuizCountdown";
import { QuizLeaderboard } from "../components/QuizLeaderboard";
import { QuizLiveIndicator } from "../components/QuizLiveIndicator";
import { QuizStatusBadge } from "../components/QuizStatusBadge";
import { quizStorage } from "../storage";
import type { QuizConfig } from "../types";
import { useQuizSession } from "../useQuizSession";

/**
 * 抢答主持台。需要登录（六条写接口都挂了 login_required，不需要额外权限）。
 *
 * 一屏三件事：**入场**（token / 链接 / 人数）、**设置**（标题 + 倒数秒数）、
 * **实况**（状态 / 倒计时 / 榜单 / 三个动作）。
 *
 * ★ 状态机（后端 service._status_for_session 现算，不是存的字段）：
 *     draft ──发布──> waiting ──到 cutoff──> open ──关闭──> closed
 *       ↑                                                      │
 *       └──────────────── 退回发布页（清空榜单）────────────────┘
 *   注意 open 之后**永不自动结束**，要主持人自己按。
 *
 * ⚠️ 本页**没有二维码**：老主持台用 qrcode 包把入口地址画成码给现场扫，
 *    但仓库里没装 @types/qrcode，公共层也还没有 QrCode 组件。按约定不在 features 里
 *    自己造一个（那样第二个要用的人会再造一份不一样的），先留链接 + 复制按钮。
 */

// 下面四个常量**只用来填 input 的 min/max/maxLength**，拦最明显的笔误。
// 真正的校验和文案在后端 service.sanitize_config，前端不另写一套（会漂移）。
const DEFAULT_WAIT_SECONDS = 6;
const MIN_WAIT_SECONDS = 3;
const MAX_WAIT_SECONDS = 600;
const MAX_TITLE_LENGTH = 240;

interface ConfigDraft {
  title: string;
  /** 存字符串而不是 number：输入框清空时 number 会变成 NaN，光标还会跳。 */
  waitSeconds: string;
}

function toConfig(draft: ConfigDraft): QuizConfig {
  // 空串 → 0 → 后端回「等待秒数需在 3~600 之间」；
  // 非数字 → NaN → JSON 里是 null → 后端回「请设置有效的等待秒数」。
  // 两句都是后端的文案，前端不抢着先报错。
  return { title: draft.title, wait_seconds: Number(draft.waitSeconds) };
}

export function QuizHostPage() {
  const toast = useToast();
  const confirm = useConfirm();

  // 手上这场活动的 token 记在 localStorage：刷新、关标签页再回来，还是同一场
  // （沿用老主持台的键名，重写前后不丢）。
  const [token, setToken] = useState(quizStorage.getHostToken);
  // status 是"界面该认的状态"：倒数到点时它会先于下一帧 snapshot 翻成 open，
  // 主持台的大屏因此不会出现"倒计时 0.0 但标签还写着倒数中"。
  const { snapshot, status, query, live, offsetMs, adopt } = useQuizSession(token);

  // null = 跟随服务端；非 null = 用户改过，以用户的为准。
  // 这样不用 useEffect 去把服务端的值"同步"进输入框 —— 那种同步在推送一来就会
  // 把人正在打的字冲掉。
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const values: ConfigDraft = draft ?? {
    title: snapshot?.config.title ?? "",
    waitSeconds: String(snapshot?.config.wait_seconds ?? DEFAULT_WAIT_SECONDS),
  };

  const failed = (fallback: string) => (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : fallback);

  const create = useMutation({
    mutationFn: createQuizSession,
    onSuccess: (snap) => {
      quizStorage.setHostToken(snap.room_token);
      setToken(snap.room_token);
      setDraft(null);
      adopt(snap);
      toast.success("已创建新的抢答活动");
    },
    onError: failed("创建失败"),
  });

  const save = useMutation({
    mutationFn: () => saveQuizConfig(token, toConfig(values)),
    onSuccess: (snap) => {
      // 四条写接口都把**最新的 snapshot** 原样回给我们，直接塞缓存就行。
      // 再 invalidate 拉一次没有意义，而且那一次的 server_now_ms 会差几毫秒，倒计时会跳一下。
      adopt(snap);
      setDraft(null);
      toast.success("设置已保存");
    },
    onError: failed("保存失败"),
  });

  const publish = useMutation({
    mutationFn: async () => {
      // 发布按的是**已保存**的 wait_seconds：先存再发，
      // 否则用户刚把 6 改成 15、直接点发布，现场还是倒数 6 秒。
      if (draft) await saveQuizConfig(token, toConfig(values));
      return publishQuizSession(token);
    },
    onSuccess: (snap) => {
      adopt(snap);
      setDraft(null);
      toast.success("已发布，开始倒数");
    },
    onError: failed("发布失败"),
  });

  const reset = useMutation({
    mutationFn: () => resetQuizSession(token),
    onSuccess: (snap) => {
      adopt(snap);
      toast.success("已退回发布页");
    },
    onError: failed("操作失败"),
  });

  const close = useMutation({
    mutationFn: () => closeQuizSession(token),
    onSuccess: (snap) => {
      adopt(snap);
      toast.success("抢答已关闭");
    },
    onError: failed("操作失败"),
  });

  const busy = save.isPending || publish.isPending || reset.isPending || close.isPending;

  // 二维码/链接是给**别人的浏览器**扫的，所以固定用网页版的路径形式，
  // 不管主持人自己是在 APK 还是网页里。publicUrl 而不是 location.origin：
  // APK 里后者是 capacitor://localhost，拼出来的地址现场谁也打不开。
  const guestUrl = token ? publicUrl(`/quiz?token=${encodeURIComponent(token)}`) : "";

  async function handleNewSession() {
    if (
      token &&
      !(await confirm({
        title: "再开一场？",
        description: `现在这场（${token}）会被丢下，已经扫过码的人要重新扫新的码。`,
        tone: "danger",
        confirmText: "再开一场",
      }))
    ) {
      return;
    }
    create.mutate();
  }

  async function handlePublish() {
    // 已经发布过再点一次 = 重新发布，后端会先清空这一轮的榜（service.publish_session）。
    if (
      snapshot &&
      snapshot.status !== "draft" &&
      !(await confirm({
        title: "重新发布？",
        description: "这一轮已经抢到的榜单会被清空，清掉就找不回来了。",
        tone: "danger",
        confirmText: "重新发布",
      }))
    ) {
      return;
    }
    publish.mutate();
  }

  async function handleReset() {
    if (
      !(await confirm({
        title: "退回发布页？",
        description: "整张榜会被清空、状态回到未发布，这一步不可撤销。",
        tone: "danger",
        confirmText: "退回并清空",
      }))
    ) {
      return;
    }
    reset.mutate();
  }

  async function handleClose() {
    if (
      !(await confirm({
        title: "关闭这场抢答？",
        description: "关闭后现场就不能再抢了。榜单会留着，要再来一轮得退回发布页。",
        tone: "danger",
        confirmText: "关闭",
      }))
    ) {
      return;
    }
    close.mutate();
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(guestUrl);
      toast.success("入口地址已复制");
    } catch {
      // 非 https 页面和一些老 WebView 上没有 clipboard 权限。地址就在输入框里，能手动选。
      toast.error("复制失败，请手动选中地址复制");
    }
  }

  return (
    <div>
      <PageHeader
        title="抢答主持台"
        description={
          snapshot ? snapshot.config.title || "未命名活动" : "现场快速抢答，扫码入场"
        }
        actions={
          <>
            <QuizLiveIndicator status={live} />
            {snapshot ? <QuizStatusBadge status={status} /> : null}
            <Button variant="outline" size="sm" loading={create.isPending} onClick={handleNewSession}>
              <Plus />
              {token ? "再开一场" : "新建活动"}
            </Button>
          </>
        }
      />

      {!token ? (
        <Card>
          <CardContent className="pt-5">
            <EmptyState
              title="还没有抢答活动"
              description="新建一场会拿到一个 6 位 token，现场的人用它入场。活动只在服务器内存里放 24 小时，过期自动消失。"
              action={
                <Button loading={create.isPending} onClick={() => create.mutate()}>
                  <Plus />
                  新建抢答活动
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        // token 过期（24h TTL）是这里**最常见**的一种"错误"，它不该长得像故障：
        // 直接给一个"再开一场"的出口。其它错误才走 ErrorState。
        quizErrorReason(query.error) === "session_not_found" ||
        quizErrorReason(query.error) === "invalid_token" ? (
          <Card>
            <CardContent className="pt-5">
              <EmptyState
                title="上一场已经过期了"
                description={`活动 ${token} 在服务器上已经找不到 —— 抢答只保留 24 小时。`}
                action={
                  <Button loading={create.isPending} onClick={() => create.mutate()}>
                    <Plus />
                    再开一场
                  </Button>
                }
              />
            </CardContent>
          </Card>
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )
      ) : snapshot ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>入场</CardTitle>
                <CardDescription>让现场的人打开这个地址</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-[var(--radius-sm)] bg-muted py-4 text-center">
                  <span className="font-mono text-4xl font-semibold tracking-[0.3em]">
                    {snapshot.room_token}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={guestUrl}
                    aria-label="抢答入口地址"
                    // 点一下就整条选中，方便在没有剪贴板权限的环境里手动复制。
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button variant="outline" size="icon" onClick={handleCopy} aria-label="复制入口地址">
                    <Copy />
                  </Button>
                </div>

                {/* TODO(二维码)：老主持台把 guestUrl 画成二维码给现场扫。
                    等公共层有了 QrCode 组件（见 blockers）再在这里加一块。 */}

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="size-4" aria-hidden />
                  {/* 人数来自 POST /quiz/guest/join 记下的在场集合。
                      ⚠️ 它只增不减：退场是靠 SSE 断开（RealtimeApp 还没注册）或者
                      2 小时 TTL 自己过期，所以这个数**偏大**，别当准数看。 */}
                  在场 {snapshot.player_count} 人
                </div>

                {snapshot.token_expires_at_ms ? (
                  <p className="text-xs text-muted-foreground">
                    有效期至 {formatClock(snapshot.token_expires_at_ms)}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>设置</CardTitle>
                <CardDescription>发布后倒数若干秒，时间一到才能抢</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="quiz-title">标题</Label>
                  <Input
                    id="quiz-title"
                    value={values.title}
                    maxLength={MAX_TITLE_LENGTH}
                    placeholder="例如：第三题"
                    onChange={(e) => setDraft({ ...values, title: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="quiz-wait">倒数秒数</Label>
                  <Input
                    id="quiz-wait"
                    type="number"
                    inputMode="numeric"
                    min={MIN_WAIT_SECONDS}
                    max={MAX_WAIT_SECONDS}
                    value={values.waitSeconds}
                    onChange={(e) => setDraft({ ...values, waitSeconds: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    {MIN_WAIT_SECONDS}~{MAX_WAIT_SECONDS} 秒。发布后从这个数倒数，到 0 才开放。
                  </p>
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button variant="ghost" disabled={!draft || busy} onClick={() => setDraft(null)}>
                    还原
                  </Button>
                  <Button variant="outline" loading={save.isPending} disabled={busy} onClick={() => save.mutate()}>
                    <Save />
                    保存
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>实况</CardTitle>
                <CardDescription>
                  {snapshot.leaderboard.length > 0
                    ? `已有 ${snapshot.leaderboard.length} 人抢到`
                    : "榜单会实时更新"}
                </CardDescription>
              </div>
              <QuizStatusBadge status={status} />
            </CardHeader>
            <CardContent className="space-y-5">
              {status === "waiting" && snapshot.cutoff_at_ms ? (
                <QuizCountdown
                  cutoffAtMs={snapshot.cutoff_at_ms}
                  offsetMs={offsetMs}
                  className="py-4"
                />
              ) : null}

              <QuizLeaderboard entries={snapshot.leaderboard} status={status} />

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  disabled={status === "draft" || busy}
                  loading={reset.isPending}
                  onClick={handleReset}
                >
                  <RotateCcw />
                  退回发布页
                </Button>
                <Button
                  variant="outline"
                  disabled={status === "draft" || status === "closed" || busy}
                  loading={close.isPending}
                  onClick={handleClose}
                >
                  <Square />
                  关闭
                </Button>
                <Button loading={publish.isPending} disabled={busy} onClick={handlePublish}>
                  <Send />
                  {status === "draft" ? "发布" : "重新发布"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

/** 只给"有效期至"用，短格式（月-日 时:分）。用 zh-CN 是为了 24 小时制。 */
function formatClock(ms: number): string {
  return new Date(ms).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
