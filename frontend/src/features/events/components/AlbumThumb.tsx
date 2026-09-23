import { Heart } from "lucide-react";
import { useState } from "react";

import { useApiQuery } from "@/shared/api/useApiQuery";
import { cn } from "@/shared/lib/cn";
import { Skeleton } from "@/shared/ui";
import type { AlbumFile } from "../types";
import { fetchMediaPath, mediaUrl } from "./mediaUrl";

/**
 * 相册缩略图 + 爱心。
 *
 * 图片地址要多问一次后端（见 mediaUrl.ts），所以每张图自己发一个查询。
 * 看起来很多请求，但 TanStack Query 会按 fileId 去重和缓存，
 * 而且转码未完成时（ready:false）会自动重试。
 */
export function AlbumThumb({
  file,
  onToggleHeart,
  onOpen,
}: {
  file: AlbumFile;
  onToggleHeart?: (file: AlbumFile) => void;
  onOpen?: (file: AlbumFile) => void;
}) {
  const [broken, setBroken] = useState(false);

  const media = useApiQuery(["media-path", file.id], () => fetchMediaPath(file.id), {
    // 转码中就过两秒再问一次。不轮询的话视频永远显示不出来。
    refetchInterval: (query) => (query.state.data?.ready === false ? 2000 : false),
  });

  const url = media.data?.ready && media.data.path ? mediaUrl(media.data.path) : null;

  return (
    <figure className="group relative overflow-hidden rounded-[var(--radius-sm)] bg-muted">
      <button
        type="button"
        onClick={() => onOpen?.(file)}
        className="block aspect-square w-full"
        aria-label={file.title || file.file_name}
      >
        {url && !broken ? (
          <img
            src={url}
            alt={file.title || file.file_name}
            // loading=lazy + decoding=async：相册动辄两三百张，
            // 不加的话首屏会同时发起几百个请求，把连接数占满。
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
            className="size-full object-cover transition-transform duration-200 group-hover:scale-105"
          />
        ) : broken ? (
          <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
            无法显示
          </div>
        ) : (
          <Skeleton className="size-full rounded-none" />
        )}
      </button>

      {/* 爱心放**底部居中**：右下角在 hover 放大（scale-105）时会被裁掉。 */}
      <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-1.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleHeart?.(file);
          }}
          className={cn(
            "pointer-events-auto flex items-center gap-1 rounded-full bg-black/45 px-2 py-1",
            "text-xs text-white backdrop-blur-sm transition-colors hover:bg-black/60",
          )}
          aria-label={file.hearted_by_me ? "取消爱心" : "点爱心"}
          aria-pressed={file.hearted_by_me ?? false}
        >
          <Heart
            className={cn("size-3.5", file.hearted_by_me && "fill-current text-destructive")}
          />
          {file.heart_count ?? 0}
        </button>
      </figcaption>
    </figure>
  );
}
