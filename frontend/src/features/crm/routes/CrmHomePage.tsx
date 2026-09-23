import { Link } from "react-router-dom";

import { useAuth } from "@/shared/auth/AuthProvider";
import { cn } from "@/shared/lib/cn";
import { EmptyState, PageHeader } from "@/shared/ui";
import { CRM_MODULES } from "@/app/navigation";

/**
 * CRM 聚合页。**与旧版对齐**：一页磁贴，点进去是各个子模块。
 *
 * 为什么是聚合而不是把模块全摊在导航条上：旧版的导航条只有 5 个图标，
 * 容不下十几个模块；而且大多数是低频的管理功能，每天用的就那几个。
 *
 * 磁贴的标题与描述沿用旧版文案（src/CRM/react/crmModules.ts）——
 * 用户已经认得它们，不要"顺手优化"。
 */
export function CrmHomePage() {
  const { hasAny } = useAuth();

  // 没权限的模块**不显示** —— 看得见但点进去 403 是最差的体验。
  const modules = CRM_MODULES.filter((m) => !m.anyOf || hasAny(m.anyOf));

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader title="CRM 管理" description={`${modules.length} 个模块`} />

      {modules.length === 0 ? (
        <EmptyState
          title="没有可用的模块"
          description="你的账号还没有被分配任何管理权限，请联系管理员。"
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => {
            const Icon = m.icon;
            return (
              <li key={m.key}>
                <Link
                  to={m.to}
                  title={`${m.title} · ${m.description}`}
                  className={cn(
                    "flex h-full items-start gap-3 rounded-[var(--radius-md)] border border-border",
                    "bg-card p-4 transition-colors",
                    "hover:border-primary/40 hover:bg-accent",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]",
                  )}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-primary-soft text-primary-strong">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">{m.title}</span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">
                      {m.description}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
