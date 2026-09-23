import { useMutation } from "@tanstack/react-query";
import { Hand, LogIn } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "@/shared/api/errors";
import {
  Badge,
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
  useToast,
} from "@/shared/ui";

import { joinQuiz, normalizeQuizToken, quizErrorReason, tapQuiz } from "../api";
import { QuizCountdown } from "../components/QuizCountdown";
import { QuizLeaderboard } from "../components/QuizLeaderboard";
import { QuizLiveIndicator } from "../components/QuizLiveIndicator";
import { QuizStatusBadge } from "../components/QuizStatusBadge";
import { quizStorage } from "../storage";
import type { QuizStatus } from "../types";
import { useQuizSession } from "../useQuizSession";

/**
 * 抢答页（现场观众）。**公开页**：这条 GET 没挂 login_required，
 * token 本身就是凭证（6 位随机 + 24h TTL），现场的人不用有账号。
 *
 * 地址沿用老前端的 /quiz?token=xxx —— 已经印出去、发出去的二维码和链接还能用。
 *
 * 三步：填名字入场 → 等倒数 → 抢。三步都只打一个后端接口，
 * 结果由接口**直接返回**（不是等 SSE 绕回来），所以按下去当场就有反馈。
 */
export function QuizGuestPage() {
  const [params] = useSearchParams();
  // 和后端 service.normalize_token 一个口径：扫码/手输最常见的脏数据就是大写和空格。
  const token = normalizeQuizToken(params.get("token"));
  const toast = useToast();

  const { snapshot, status, query, live, offsetMs, adopt } = useQuizSession(token);

  // guest_id 只在本机 localStorage 里，服务端靠它做"一人一次"。
  // useState 的惰性初始化：只在首次渲染算一次，不会每次渲染都读一遍 localStorage。
  const [guestId] = useState(quizStorage.getOrCreateGuestId);
  const [name, setName] = useState(quizStorage.getGuestName);
  const [joined, setJoined] = useState(false);

  const myEntry = snapshot?.leaderboard.find((row) => row.guest_id === guestId) ?? null;
  const trimmedName = name.trim();

  // 榜上已经有我 = 这一轮肯定入过场了。刷新页面不该再让人把名字填一遍
  // （而且名字已经写进这条记录里，改也改不动了）。
  const identified = joined || Boolean(myEntry);

  const join = useMutation({
    mutationFn: () => joinQuiz(token, { guest_id: guestId, guest_name: trimmedName }),
    onSuccess: (snap) => {
      quizStorage.setGuestName(trimmedName);
      setJoined(true);
      adopt(snap);
      toast.success(`入场成功，${trimmedName}`);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "入场失败"),
  });

  const tap = useMutation({
    // client_clicked_at_ms 用**校准过**的本地时间：后端只是原样存起来给人看，
    // 送未校准的时间过去，和 server_received_at_ms 摆在一起会差出几十秒。
    mutationFn: () =>
      tapQuiz(token, { guest_id: guestId, guest_name: trimmedName }, Math.round(Date.now() + offsetMs)),
    onSuccess: (snap) => {
      adopt(snap);
      toast.success("抢到了！");
    },
    // 被拒绝的理由（already_tapped / too_early / not_published / closed）后端都给了
    // 中文文案，直接用它 —— 前端再写一套只会和后端漂移。
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "没抢上"),
  });

  function handleJoin(event: FormEvent) {
    event.preventDefault();
    join.mutate();
  }

  return (
    <div className="mx-auto w-full max-w-2xl py-8">
      <PageHeader
        title={snapshot?.config.title || "抢答"}
        description={token ? `活动 ${token}` : "现场快速抢答"}
        actions={
          snapshot ? (
            <>
              <QuizLiveIndicator status={live} />
              <QuizStatusBadge status={status} />
            </>
          ) : null
        }
      />

      {!token ? (
        // 不带 token 干脆不发请求：后端会回 400「缺少抢答 token」，但那不是"出错"，
        // 是"这个人不该直接打开这一页"。发出去只会换回一条红色错误提示。
        <Card>
          <CardContent className="pt-5">
            <EmptyState
              title="请从活动页进入"
              description="这一页要带抢答 token 才能打开：扫主持人屏幕上的二维码，或者点主持人发的链接。"
            />
          </CardContent>
        </Card>
      ) : query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <Card>
          <CardContent className="pt-5">{renderError(query.error, query.refetch)}</CardContent>
        </Card>
      ) : snapshot ? (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{identified ? "准备抢答" : "先入场"}</CardTitle>
              <CardDescription>
                {identified
                  ? status === "waiting"
                    ? "倒数结束才算数，早按无效"
                    : "按钮变亮时按下去，看谁快"
                  : "填个名字，主持人屏幕上会看到你入场"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {status === "waiting" && snapshot.cutoff_at_ms ? (
                <QuizCountdown cutoffAtMs={snapshot.cutoff_at_ms} offsetMs={offsetMs} className="py-2" />
              ) : null}

              {myEntry ? (
                <div className="flex items-center justify-center gap-3 rounded-[var(--radius-sm)] bg-primary-soft py-4">
                  <Badge variant="primary">第 {myEntry.rank} 名</Badge>
                  <span className="font-mono text-sm tabular-nums text-muted-foreground">
                    +{myEntry.delta_from_cutoff_ms}ms
                  </span>
                </div>
              ) : null}

              {identified ? (
                <div className="space-y-3">
                  <Button
                    size="lg"
                    className="h-28 w-full text-2xl"
                    // 只有真开放了才让按：早按会被后端按 too_early 拒掉，
                    // 白白让人以为自己抢了。抢过一次之后也禁掉（后端 hsetnx 只认第一次）。
                    disabled={status !== "open" || Boolean(myEntry)}
                    loading={tap.isPending}
                    onClick={() => tap.mutate()}
                  >
                    <Hand />
                    {tapLabel(status, Boolean(myEntry))}
                  </Button>
                  {/* 抢过之后名字就定在那条记录上了，不给改，免得以为改了榜上也会变。 */}
                  {myEntry ? null : (
                    <Button variant="ghost" className="w-full" onClick={() => setJoined(false)}>
                      我是{trimmedName || "这位"}，改个名字
                    </Button>
                  )}
                </div>
              ) : (
                <form onSubmit={handleJoin} className="space-y-3">
                  {/* 校验交给后端：名字为空它回「请先输入名称」。这里的 required
                      只拦最明显的笔误，不另写一套文案。 */}
                  <div className="space-y-1.5">
                    <Label htmlFor="quiz-guest-name">我的名字</Label>
                    <Input
                      id="quiz-guest-name"
                      required
                      maxLength={80}
                      value={name}
                      placeholder="现场叫你的那个名字"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <Button type="submit" size="lg" className="w-full" loading={join.isPending}>
                    <LogIn />
                    入场
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>排行榜</CardTitle>
                <CardDescription>按服务端收到的先后排，不看各人手机的时间</CardDescription>
              </div>
              <Badge variant="neutral">{snapshot.leaderboard.length} 人</Badge>
            </CardHeader>
            <CardContent>
              <QuizLeaderboard
                entries={snapshot.leaderboard}
                status={status}
                mineGuestId={guestId}
              />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

/** 按钮上的字。抢过之后不再变，免得让人以为还能再抢一次。 */
function tapLabel(status: QuizStatus, tapped: boolean): string {
  if (tapped) return "已抢到";
  if (status === "waiting") return "等倒数结束";
  if (status === "open") return "抢！";
  if (status === "closed") return "已结束";
  return "等主持人发布";
}

/**
 * 错误分支。
 *
 * token 的两种"不对"和一种"过期"都不该长得像系统故障 —— 现场的人扫错码、
 * 用昨天的链接进来都很常见，给他们一句人话，别给一个红色叹号。
 * 其它错误（网络、500）才走 ErrorState，它显示的是后端的中文文案。
 */
function renderError(error: unknown, retry: () => void) {
  const reason = quizErrorReason(error);
  if (reason === "missing_token" || reason === "invalid_token") {
    return (
      <EmptyState
        title="这个链接不对"
        description="抢答地址要带一个 6 位的 token。扫一下主持人屏幕上的二维码，或者重新点一次主持人发的链接。"
      />
    );
  }
  if (reason === "session_not_found") {
    return (
      <EmptyState
        title="这场抢答结束了"
        description="活动只保留 24 小时，过后就找不到了。找主持人要新的链接。"
      />
    );
  }
  return <ErrorState error={error} onRetry={() => void retry()} />;
}
