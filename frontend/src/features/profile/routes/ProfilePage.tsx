import { CalendarDays, FileText, GraduationCap, Receipt } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useApiQuery } from "@/shared/api/useApiQuery";
import { useAuth } from "@/shared/auth/AuthProvider";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  PageHeader,
  Skeleton,
} from "@/shared/ui";
import { fetchFootprints, fetchMembershipContext, profileKeys } from "../api";

export function ProfilePage() {
  const { user, permissions } = useAuth();
  const footprints = useApiQuery(profileKeys.footprints(), fetchFootprints);
  const membership = useApiQuery(profileKeys.membership(), fetchMembershipContext);

  const s = footprints.data?.summary;

  return (
    <div>
      <PageHeader
        title={user?.display_name || user?.username || "我的资料"}
        description={user?.username ? `@${user.username}` : undefined}
      />

      <div className="space-y-6">
        {/* 我的足迹：四个计数。后端保证 summary 结构完整（没绑 NRIC 时全 0），
            所以这里不用为"没有会员档案"写第二套渲染。 */}
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">我的足迹</h2>
          {footprints.isPending ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : footprints.isError ? (
            <ErrorState error={footprints.error} onRetry={() => void footprints.refetch()} />
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard icon={FileText} label="报名表" value={s?.registration_form_count ?? 0} />
              <StatCard icon={CalendarDays} label="参加活动" value={s?.event_count ?? 0} />
              <StatCard icon={GraduationCap} label="佛学班" value={s?.youth_class_count ?? 0} />
              <StatCard icon={Receipt} label="缴费记录" value={s?.payment_count ?? 0} />
            </div>
          )}
        </section>

        <Card>
          <CardHeader>
            <CardTitle>会员状态</CardTitle>
          </CardHeader>
          <CardContent>
            {membership.isPending ? (
              <Skeleton className="h-5 w-40" />
            ) : membership.isError ? (
              <ErrorState error={membership.error} onRetry={() => void membership.refetch()} />
            ) : (
              <div className="space-y-2 text-sm">
                <p className="text-muted-foreground">
                  {membership.data?.context.registration_route.message || "—"}
                </p>
                {membership.data?.context.is_minor ? <Badge variant="info">未成年</Badge> : null}
              </div>
            )}
          </CardContent>
        </Card>

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
                    <span className="text-muted-foreground">
                      {d.permissions?.length ?? 0} 项权限
                    </span>
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
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <Card className="p-4">
      <Icon className="mb-2 size-5 text-primary" aria-hidden />
      <p className="font-serif text-2xl leading-none">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </Card>
  );
}
