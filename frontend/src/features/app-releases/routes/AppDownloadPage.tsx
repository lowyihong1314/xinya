import { Download, Smartphone } from "lucide-react";

import { useApiQuery } from "@/shared/api/useApiQuery";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "@/shared/ui";
import { appReleaseKeys, downloadHref, fetchAppReleases } from "../api";
import type { AppRelease } from "../types";

/**
 * 下载 App。**公开页**（后端两条路由都没挂鉴权），放在 PublicLayout 下 ——
 * 这条链接常常是印在二维码里、发在群里的，要求先登录等于让人下不到包。
 *
 * 下载一律用 <a href> 直链，不经过 http 客户端：理由见 ../api.ts 的 downloadHref()。
 */
export function AppDownloadPage() {
  const list = useApiQuery(appReleaseKeys.list(), fetchAppReleases);

  // 后端按 mtime 倒序，所以第一个是最新包，其余是历史版本。
  const [latest, ...older] = list.data ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl py-8">
      <PageHeader
        title="下载 App"
        description="地南佛学会 UTBA · Android 安装包（APK）"
      />

      {list.isPending ? (
        // 骨架屏而不是转圈：这页只有两三块内容，形状先占住，出数据时不整段跳动。
        <div className="space-y-4">
          <Skeleton className="h-44" />
          <Skeleton className="h-32" />
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : latest ? (
        <div className="space-y-6">
          <LatestCard release={latest} />
          {older.length > 0 ? <OlderCard releases={older} /> : null}
          <InstallNotes />
        </div>
      ) : (
        <EmptyState
          title="暂时没有可下载的版本"
          description="新版本发布后会出现在这里。"
          className="min-h-56"
        />
      )}
    </div>
  );
}

/** 最新版：单独一块，按钮做大 —— 九成的人只需要点这一下。 */
function LatestCard({ release }: { release: AppRelease }) {
  const label = describe(release.filename);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Smartphone className="size-5 text-primary" aria-hidden />
          {label.version ?? "最新版本"}
          <Badge variant="primary">最新</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="shrink-0 text-muted-foreground">文件</dt>
            {/* 文件名要能看全：出问题时用户念给我们听的就是这串 */}
            <dd className="min-w-0 break-all font-mono text-xs leading-5">{release.filename}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 text-muted-foreground">大小</dt>
            <dd>{release.size_label}</dd>
          </div>
          {label.built ? (
            <div className="flex gap-2">
              <dt className="shrink-0 text-muted-foreground">打包时间</dt>
              <dd>{label.built}</dd>
            </div>
          ) : null}
        </dl>

        <Button asChild size="lg" className="w-full sm:w-auto">
          {/* download 属性只是给浏览器一个文件名建议；真正让它存盘的是后端的
              Content-Disposition: attachment，所以点了不会在页面里打开一堆二进制。 */}
          <a href={downloadHref(release)} download={release.filename}>
            <Download aria-hidden />
            下载安装包 · {release.size_label}
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

/** 历史版本：新版本装出问题时要能退回去，所以旧包不藏起来，但也不占主位。 */
function OlderCard({ releases }: { releases: AppRelease[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>历史版本</CardTitle>
      </CardHeader>
      <CardContent className="p-0 pt-0">
        <ul className="divide-y divide-border">
          {releases.map((release) => {
            const label = describe(release.filename);
            return (
              <li
                key={release.filename}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{label.version ?? release.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {[label.built, release.size_label].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <a href={downloadHref(release)} download={release.filename}>
                    <Download aria-hidden />
                    下载
                  </a>
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/** 安装提示。这三条是支持群里被问得最多的，写在页面上比一个个回答便宜。 */
function InstallNotes() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>安装说明</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
          <li>用手机浏览器打开本页并下载，下完在通知栏点这个文件。</li>
          <li>系统提示「不允许安装未知来源的应用」时，按提示给浏览器开一次权限即可。</li>
          <li>iPhone 装不了 APK，请直接用浏览器访问本站（可「添加到主屏幕」）。</li>
        </ol>
      </CardContent>
    </Card>
  );
}

/**
 * 从文件名里挖版本号和打包时间：UTBA_BETA_v1.5.1_b10_20260701_1257.apk
 * → { version: "v1.5.1（build 10）", built: "2026-07-01 12:57" }。
 *
 * 后端只给了 filename/size/url，没有结构化的版本字段，所以只能从名字解析。
 * **认不出来就整条返回 undefined**，页面退回显示原始文件名 —— 哪天打包脚本改了命名，
 * 这页最坏是变丑，不会变空或者显示一个猜错的版本号。
 */
function describe(filename: string): { version?: string; built?: string } {
  const m = /_v([\d.]+)(?:_b(\d+))?_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})\b/.exec(filename);
  if (!m) return {};
  const [, version, build, year, month, day, hour, minute] = m;
  return {
    version: build ? `v${version}（build ${build}）` : `v${version}`,
    built: `${year}-${month}-${day} ${hour}:${minute}`,
  };
}
