import { CalendarDays, FileText, GraduationCap, Receipt } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, Navigate, NavLink, useParams } from "react-router-dom";

import { EmailPage } from "@/features/email/routes/EmailPage";
import { useApiQuery } from "@/shared/api/useApiQuery";
import { useAuth } from "@/shared/auth/AuthProvider";
import { cn } from "@/shared/lib/cn";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  PageHeader,
  Skeleton,
} from "@/shared/ui";
import { ProfileForm } from "../components/ProfileForm";
import { fetchFootprints, fetchMembershipContext, profileKeys } from "../api";
import { DEFAULT_SECTION, PROFILE_SECTIONS, isProfileSection } from "../sections";

/**
 * 用户资料。五个分节与旧版一致（原 /profile/:section）：
 * 资料 / 会员 / 邮件 / 足迹 / 下载 App。
 *
 * 「邮件」分节直接复用 features/email 的页面 —— 旧版也是同一块内容，
 * 没必要写两份。/email 那条独立路由保留（CRM 磁贴指向它）。
 */
export function ProfilePage() {
  const { section } = useParams();
  const { user } = useAuth();

  if (!isProfileSection(section)) {
    return <Navigate to={`/profile/${DEFAULT_SECTION}`} replace />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title={user?.display_name || user?.username || "我的资料"}
        description={user?.username ? `@${user.username}` : undefined}
      />

      {/* 分节导航。手机上横滑不折行。 */}
      <nav className="-mx-4 mb-6 overflow-x-auto px-4" aria-label="资料分节">
        <ul className="flex w-max gap-2">
          {PROFILE_SECTIONS.map((s) => (
            <li key={s.key}>
              <NavLink
                to={`/profile/${s.key}`}
                className={({ isActive }) =>
                  cn(
                    "block min-w-[6.5rem] rounded-[var(--radius-md)] border px-3 py-2 transition-colors",
                    isActive
                      ? "border-primary/40 bg-primary-soft"
                      : "border-border bg-card hover:bg-accent",
                  )
                }
              >
                <span className="block text-sm font-medium">{s.label}</span>
                <span className="block text-[10px] text-muted-foreground">{s.hint}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {section === "profile" ? <ProfileForm /> : null}
      {section === "membership" ? <MembershipSection /> : null}
      {section === "email" ? <EmailPage /> : null}
      {section === "journey" ? <JourneySection /> : null}
      {section === "app" ? <AppSection /> : null}
    </div>
  );
}

function MembershipSection() {
  const q = useApiQuery(profileKeys.membership(), fetchMembershipContext);
  if (q.isPending) return <Skeleton className="h-24" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;

  const ctx = q.data.context;
  return (
    <Card>
      <CardHeader>
        <CardTitle>会员状态</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{ctx.registration_route.message || "—"}</p>
        <div className="flex flex-wrap gap-1.5">
          {ctx.is_minor ? <Badge variant="info">未成年</Badge> : null}
          {ctx.registration_route.eligible ? (
            <Badge variant="success">可办理{ctx.registration_route.target_label || ""}</Badge>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function JourneySection() {
  const { user, permissions } = useAuth();
  const q = useApiQuery(profileKeys.footprints(), fetchFootprints);

  if (q.isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const s = q.data?.summary;
  return (
    <div className="space-y-6">
      {/* 后端保证 summary 结构完整（没绑 NRIC 时五个计数全 0），
          所以这里不用为"没有会员档案"写第二套渲染。 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={FileText} label="报名表" value={s?.registration_form_count ?? 0} />
        <Stat icon={CalendarDays} label="参加活动" value={s?.event_count ?? 0} />
        <Stat icon={GraduationCap} label="佛学班" value={s?.youth_class_count ?? 0} />
        <Stat icon={Receipt} label="缴费记录" value={s?.payment_count ?? 0} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>我的部门与权限</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {user?.departments?.length ? (
            <ul className="space-y-1.5 text-sm">
              {user.departments.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{d.name}</span>
                  <span className="text-muted-foreground">{d.permissions?.length ?? 0} 项权限</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">还没有加入任何部门</p>
          )}
          <p className="text-xs text-muted-foreground">
            合计 {permissions.size} 项权限（多个部门的权限会合并去重）
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function AppSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>下载 App</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          安卓版可以直接下载安装包。下载页也可以分享给别人。
        </p>
        <Button asChild>
          <Link to="/app-download">前往下载页</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <Card className="p-4">
      <Icon className="mb-2 size-5 text-primary" aria-hidden />
      <p className="font-serif text-2xl leading-none">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </Card>
  );
}
