import { useEffect, useState } from "react";

import { cn } from "@/shared/lib/cn";

/**
 * 倒计时。
 *
 * ★ 时间轴以**服务端**为准：传进来的 offsetMs 是 useQuizSession 算好的
 *   「服务端时钟 − 本地时钟」。现场观众用的是自己的手机，系统时间差几十秒很常见，
 *   直接拿 Date.now() 和 cutoff_at_ms 比，倒计时会一上来就是 0，或者停在天文数字上。
 *
 * ⚠️ 归零之后**不会自己变绿**：status 是后端每次现算的，waiting → open 这一步没有推送，
 *    要等下一帧 snapshot（SSE 或 3 秒轮询）回来。所以归零时显示的是"即将开放"，
 *    而不是假装已经可以抢 —— 提前让人点下去，点了也会被后端按 too_early 拒掉。
 */
export function QuizCountdown({
  cutoffAtMs,
  offsetMs,
  className,
}: {
  cutoffAtMs: number;
  offsetMs: number;
  className?: string;
}) {
  // 100ms 一跳：再慢就看得出卡顿，再快也没人分得清。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);

  const remainingMs = Math.max(0, cutoffAtMs - (now + offsetMs));

  return (
    <div className={cn("flex flex-col items-center gap-1", className)} role="timer" aria-live="off">
      {/* tabular-nums：不等宽数字会让"9.9 → 10.0"时整行左右跳。 */}
      <span className="font-mono text-6xl leading-none font-semibold tabular-nums">
        {(remainingMs / 1000).toFixed(1)}
      </span>
      <span className="text-sm text-muted-foreground">
        {remainingMs > 0 ? "秒后开放抢答" : "即将开放…"}
      </span>
    </div>
  );
}
