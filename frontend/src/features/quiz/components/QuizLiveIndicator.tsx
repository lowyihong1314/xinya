import { RefreshCw, Wifi } from "lucide-react";

import type { RealtimeStatus } from "@/shared/realtime";
import { Badge } from "@/shared/ui";

/**
 * 实时连接指示灯。
 *
 * 为什么要把它摆在界面上：抢答是"盯着屏幕等数字变"的场景，一旦推送断了而界面
 * 一声不吭，主持人会以为是没人抢。说清楚"现在靠每 3 秒刷新"，比假装实时好。
 *
 * ★ 现在它**一定**显示轮询：后端 quiz 还没 register(RealtimeApp(...))，
 *   /quiz/realtime 回 404。等后端注册完，这里会自己变成"实时"，不用改代码。
 */
export function QuizLiveIndicator({ status }: { status: RealtimeStatus }) {
  if (status === "open") {
    return (
      <Badge variant="success" className="gap-1">
        <Wifi className="size-3" aria-hidden />
        实时
      </Badge>
    );
  }
  return (
    <Badge variant="neutral" className="gap-1">
      <RefreshCw className="size-3" aria-hidden />
      每 3 秒刷新
    </Badge>
  );
}
