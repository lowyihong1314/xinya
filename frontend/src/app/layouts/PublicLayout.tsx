/**
 * 不需要登录的页面外壳（登录页、分享页、公开表单）。
 * 故意**不放顶栏和导航**：这些页面常常是外部链接点进来的，
 * 给一个能点去 CRM 的导航只会让人撞上 401。
 */
import { Outlet } from "react-router-dom";

export function PublicLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <main className="flex flex-1 flex-col px-4 py-[env(safe-area-inset-top)]">
        <Outlet />
      </main>
    </div>
  );
}
