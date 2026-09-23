import { aboutKeys, fetchAboutUs, fetchHistory } from "../api";
import { useApiQuery } from "@/shared/api/useApiQuery";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "@/shared/ui";

/**
 * 关于我们。**公开页**（后端两条接口都没挂 login_required），
 * 所以放在 PublicLayout 下，未登录也能看。
 *
 * 路由是 /about 而不是 /info —— 后端占着 /info/*，撞车的前端路由永远到不了浏览器。
 */
export function AboutPage() {
  const about = useApiQuery(aboutKeys.aboutUs(), fetchAboutUs);
  const history = useApiQuery(aboutKeys.history(), fetchHistory);

  return (
    <div className="mx-auto w-full max-w-3xl py-8">
      <PageHeader title="关于我们" description="地南佛学会 · UTBA" />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>简介</CardTitle>
          </CardHeader>
          <CardContent>
            {about.isPending ? (
              // 骨架屏而不是转圈：用户能预判内容形状，切到真内容时不会整段跳动
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ) : about.isError ? (
              <ErrorState error={about.error} onRetry={() => void about.refetch()} />
            ) : about.data?.length ? (
              <div className="space-y-4">
                {about.data.map((entry) => (
                  <p key={entry.id} className="whitespace-pre-wrap leading-7">
                    {entry.text}
                  </p>
                ))}
              </div>
            ) : (
              <EmptyState title="还没有内容" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>我们的历史</CardTitle>
          </CardHeader>
          <CardContent>
            {history.isPending ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-10/12" />
              </div>
            ) : history.isError ? (
              <ErrorState error={history.error} onRetry={() => void history.refetch()} />
            ) : history.data?.length ? (
              // 时间线：左侧一条竖线 + 圆点。用 border-l 而不是绝对定位，
              // 这样条目高度变化时线条自动跟着长。
              <ol className="space-y-6 border-l border-border pl-6">
                {history.data.map((entry) => (
                  <li key={entry.id} className="relative">
                    <span
                      className="absolute -left-[calc(1.5rem+5px)] top-2 size-2.5 rounded-full bg-primary"
                      aria-hidden
                    />
                    <p className="whitespace-pre-wrap leading-7">{entry.text}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState title="还没有历史记录" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
