import { Link } from "react-router-dom";

import { Button, EmptyState } from "@/shared/ui";

export function NotFoundPage() {
  return (
    <EmptyState
      title="页面不存在"
      description="链接可能已经失效，或者被移动到了别处。"
      action={
        <Button asChild variant="outline" size="sm">
          <Link to="/">回到首页</Link>
        </Button>
      }
      className="min-h-[60svh]"
    />
  );
}
