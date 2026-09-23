import { History, Radio } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/shared/ui";

/**
 * 直播 / 回放 切换，放在 PageHeader 的 actions 里。
 *
 * 做成两条真路由而不是页内 tab：地址能分享、刷新回到同一个视图，
 * 而且不用为此在 shared/ui 里造一个只有这里用得上的 Tabs。
 */
export function ViewSwitch({ current }: { current: "live" | "playback" }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-secondary p-1">
      <Button
        asChild
        size="sm"
        variant={current === "live" ? "primary" : "ghost"}
        className="rounded-full"
      >
        <Link to="/cctv" aria-current={current === "live" ? "page" : undefined}>
          <Radio />
          直播
        </Link>
      </Button>
      <Button
        asChild
        size="sm"
        variant={current === "playback" ? "primary" : "ghost"}
        className="rounded-full"
      >
        <Link to="/cctv/playback" aria-current={current === "playback" ? "page" : undefined}>
          <History />
          回放
        </Link>
      </Button>
    </div>
  );
}
