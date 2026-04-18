import type { ReactNode } from "react";

import type { LyricProjectionBlock } from "../../projection";
import {
  collapseArrowStyle,
  collapseBodyStyle,
  collapseCardStyle,
  collapseHeaderStyle,
  collapseSubtitleStyle,
  contextMenuItemStyle,
  contextMenuLayerStyle,
  contextMenuStyle,
  projectionBlockStyle,
  projectionBlockTextStyle,
  projectionColumnCompactStyle,
  sectionTitleStyle,
} from "./styles";

export function CollapseCard({
  title,
  subtitle,
  open = true,
  onToggle,
  children,
}: {
  title: string;
  subtitle?: string;
  open?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  return (
    <section style={collapseCardStyle}>
      <button type="button" onClick={onToggle} style={collapseHeaderStyle}>
        <div>
          <div style={sectionTitleStyle}>{title}</div>
          {subtitle ? <div style={collapseSubtitleStyle}>{subtitle}</div> : null}
        </div>
        {onToggle ? <span style={collapseArrowStyle}>{open ? "收起" : "展开"}</span> : null}
      </button>
      {open ? <div style={collapseBodyStyle}>{children}</div> : null}
    </section>
  );
}

export function ProjectionColumn({
  blocks,
  currentProjectedBlocks,
  activeMarkerIndex,
  fontSize,
  onSelectMarker,
}: {
  blocks: LyricProjectionBlock[];
  currentProjectedBlocks: LyricProjectionBlock[];
  activeMarkerIndex: number | null | undefined;
  fontSize: number;
  onSelectMarker: (index: number, clickable: boolean) => void;
}) {
  return (
    <div style={projectionColumnCompactStyle}>
      {blocks.map((block, blockIndex) => {
        const projectedBlockIndex = currentProjectedBlocks.findIndex((item) => item.id === block.id);
        const resolvedIndex = projectedBlockIndex >= 0 ? projectedBlockIndex : blockIndex;
        const active = activeMarkerIndex === resolvedIndex;
        const clickable = Boolean(block.highlightable);
        return (
          <button
            key={block.id || `${resolvedIndex}`}
            type="button"
            onClick={() => onSelectMarker(resolvedIndex, clickable)}
            style={projectionBlockStyle(active, clickable)}
          >
            <pre style={projectionBlockTextStyle(fontSize)}>{block.text}</pre>
          </button>
        );
      })}
    </div>
  );
}

export function ProjectionLyricsContextMenu({
  menu,
  onEdit,
}: {
  menu: { x: number; y: number } | null;
  onEdit: () => void;
}) {
  if (!menu) {
    return null;
  }

  return (
    <div style={contextMenuLayerStyle} onContextMenu={(event) => event.preventDefault()}>
      <div
        style={contextMenuStyle(menu.x, menu.y)}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" style={contextMenuItemStyle} onClick={onEdit}>
          编辑
        </button>
      </div>
    </div>
  );
}
