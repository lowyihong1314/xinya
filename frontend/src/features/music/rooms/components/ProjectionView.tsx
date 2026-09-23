/**
 * 投屏内容的渲染：若干块 + 当前高亮的那一块。
 *
 * 控制台（预览、点块挪高亮）和播放端（大屏显示、自动滚到高亮处）共用它 ——
 * 这是本模块唯一被两个页面用到的组件，所以才放进 components/。
 *
 * ★ 歌词一律 font-mono + whitespace-pre-wrap：和弦是靠空格对齐到字上方的，
 *   换比例字体或者折叠空格，和弦会整片错位。songbook 详情页同理。
 */
import { useEffect, useRef } from "react";

import { cn } from "@/shared/lib/cn";
import { EmptyState } from "@/shared/ui";
import type { ProjectionBlock } from "../types";

export function ProjectionView({
  blocks,
  markerIndex,
  /** 传了就可点：点可高亮的块 = 把标记挪过去，再点当前这块 = 取消标记（传 null）。 */
  onSelectBlock,
  /** 播放端用：高亮换了就把它滚到视野中间。控制台不要开，会抢走用户的滚动。 */
  autoScroll = false,
  /** 字号交给调用方 —— 播放端要能调大到投影仪上看得清。 */
  textClassName = "text-sm leading-7",
  className,
}: {
  blocks: readonly ProjectionBlock[];
  markerIndex: number | null;
  onSelectBlock?: (index: number | null) => void;
  autoScroll?: boolean;
  textClassName?: string;
  className?: string;
}) {
  const activeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!autoScroll) return;
    // block: "center" 而不是默认的 "start"：大屏上把当前句放中间，
    // 前后各留几行，唱的人能看到下一句。
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [autoScroll, markerIndex]);

  if (!blocks.length) {
    return <EmptyState title="还没有投放内容" description="控制台选一页投出去" className={className} />;
  }

  return (
    <div className={cn("space-y-4", className)}>
      {blocks.map((block, index) => {
        const active = index === markerIndex;
        const clickable = Boolean(onSelectBlock) && block.highlightable;

        return (
          <div key={block.id} ref={active ? activeRef : undefined}>
            <Block
              block={block}
              active={active}
              textClassName={textClassName}
              onClick={clickable ? () => onSelectBlock?.(active ? null : index) : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}

function Block({
  block,
  active,
  textClassName,
  onClick,
}: {
  block: ProjectionBlock;
  active: boolean;
  textClassName: string;
  onClick?: () => void;
}) {
  const body = (
    <pre
      className={cn(
        "whitespace-pre-wrap font-mono",
        textClassName,
        // 不能高亮的块（段落标题、纯和弦）弱化一档，免得和歌词抢注意力
        block.highlightable ? "text-foreground" : "text-muted-foreground",
        active && "text-primary-strong",
      )}
    >
      {block.text}
    </pre>
  );

  const shell = cn(
    "w-full rounded-[var(--radius-sm)] border px-4 py-3 text-left transition-colors",
    active ? "border-primary bg-primary-soft" : "border-transparent",
  );

  if (!onClick) return <div className={shell}>{body}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        shell,
        "hover:border-border hover:bg-accent",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]",
      )}
    >
      {body}
    </button>
  );
}
