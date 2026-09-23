import { Navigate, NavLink, useParams } from "react-router-dom";

import { useApiQuery } from "@/shared/api/useApiQuery";
import { cn } from "@/shared/lib/cn";
import {
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "@/shared/ui";
import {
  aboutKeys,
  fetchAboutUs,
  fetchHistory,
  fetchMembers,
  fetchTreeHole,
} from "../api";
import { ABOUT_SECTIONS, DEFAULT_SECTION, isAboutSection } from "../sections";

/**
 * 简介页。**公开页**（后端那几条接口没挂 login_required），不要求登录。
 *
 * 四个分节与旧版一致（原 /info/:section）：历程 / 简介 / 成员 / 树洞。
 * 新地址是 /about/:section —— 后端占着 /info/*，撞车的前端路由永远到不了浏览器。
 */
export function AboutPage() {
  const { section } = useParams();

  // 没带分节或分节名不认识 → 回默认那个（旧版进 /info 会 Navigate 到 /info/history）
  if (!isAboutSection(section)) {
    return <Navigate to={`/about/${DEFAULT_SECTION}`} replace />;
  }

  const active = ABOUT_SECTIONS.find((s) => s.key === section)!;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title="关于我们" description="地南佛学会 · UTBA" />

      {/* 分节导航。手机上横滑，不折行 —— 折成两行会把内容推得很低 */}
      <nav className="-mx-4 mb-6 overflow-x-auto px-4" aria-label="简介分节">
        <ul className="flex w-max gap-2">
          {ABOUT_SECTIONS.map((s) => (
            <li key={s.key}>
              <NavLink
                to={`/about/${s.key}`}
                className={({ isActive }) =>
                  cn(
                    "block min-w-[9rem] rounded-[var(--radius-md)] border p-3 transition-colors",
                    isActive
                      ? "border-primary/40 bg-primary-soft"
                      : "border-border bg-card hover:bg-accent",
                  )
                }
              >
                <span className="block text-[10px] uppercase tracking-widest text-muted-foreground">
                  {s.eyebrow}
                </span>
                <span className="mt-0.5 block text-sm font-medium">{s.title}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <p className="mb-4 text-sm text-muted-foreground">{active.subtitle}</p>

      {section === "history" ? <HistorySection /> : null}
      {section === "about" ? <AboutSection /> : null}
      {section === "members" ? <MembersSection /> : null}
      {section === "tree-hole" ? <TreeHoleSection /> : null}
    </div>
  );
}

function HistorySection() {
  const q = useApiQuery(aboutKeys.history(), fetchHistory);
  if (q.isPending) return <TextSkeleton lines={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data?.length) return <EmptyState title="还没有历史记录" />;

  return (
    <Card>
      <CardContent className="pt-5">
        {/* 时间线：左侧竖线 + 圆点。用 border-l 而不是绝对定位，
            这样条目高度变化时线条自动跟着长。 */}
        <ol className="space-y-6 border-l border-border pl-6">
          {q.data.map((entry) => (
            <li key={entry.id} className="relative">
              <span
                className="absolute -left-[calc(1.5rem+5px)] top-2 size-2.5 rounded-full bg-primary"
                aria-hidden
              />
              <p className="whitespace-pre-wrap leading-7">{entry.text}</p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function AboutSection() {
  const q = useApiQuery(aboutKeys.aboutUs(), fetchAboutUs);
  if (q.isPending) return <TextSkeleton lines={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data?.length) return <EmptyState title="还没有内容" />;

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        {q.data.map((entry) => (
          <p key={entry.id} className="whitespace-pre-wrap leading-7">
            {entry.text}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

function MembersSection() {
  const q = useApiQuery(aboutKeys.members(), fetchMembers);
  if (q.isPending) return <TextSkeleton lines={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data?.data.length) return <EmptyState title="还没有成员" />;

  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {q.data.data.map((m) => (
        <li key={m.id}>
          <Card className="p-3">
            <p className="truncate font-medium">{m.display_name || m.username}</p>
            <p className="truncate text-xs text-muted-foreground">@{m.username}</p>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function TreeHoleSection() {
  const q = useApiQuery(aboutKeys.treeHole(), fetchTreeHole);
  if (q.isPending) return <TextSkeleton lines={3} />;
  // 没权限时后端回 403 + 「没有权限查看树洞留言」，ErrorState 直接显示那句中文 ——
  // 不要在前端再写一套「你没有权限」，两处文案迟早漂移。
  if (q.isError) return <ErrorState error={q.error} />;
  if (!q.data?.length) return <EmptyState title="树洞还是空的" />;

  return (
    <ul className="space-y-2">
      {q.data.map((msg) => (
        <li key={msg.id}>
          <Card className="p-4">
            <p className="whitespace-pre-wrap leading-7">{msg.content}</p>
            <p className="mt-2 text-xs text-muted-foreground">{msg.created_at}</p>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function TextSkeleton({ lines }: { lines: number }) {
  return (
    <Card>
      <CardContent className="space-y-2 pt-5">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className={cn("h-4", i === lines - 1 ? "w-3/5" : "w-full")} />
        ))}
      </CardContent>
    </Card>
  );
}
