import { Link } from "react-router-dom";

import { Button, EmptyState } from "@/shared/ui";

/**
 * 403。与登录页分开是有意的：已经登录但没权限的人如果被弹去登录页，
 * 会以为自己账号出了问题，反复重登也没用。
 */
export function ForbiddenPage() {
  return (
    <EmptyState
      title="没有访问权限"
      description="这个功能需要额外权限，请联系管理员开通。"
      action={
        <Button asChild variant="outline" size="sm">
          <Link to="/">回到首页</Link>
        </Button>
      }
      className="min-h-[60svh]"
    />
  );
}
