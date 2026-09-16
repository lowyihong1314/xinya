import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";

/**
 * 照片右下角的爱心：一人一张只能按一次，再按一次取消。
 * 卡片本身点了会开大图，所以这里把指针事件全截住。
 */
export function PhotoHeartButton({
  fileId,
  count,
  hearted,
  busy = false,
  onToggle,
}: {
  fileId: number;
  count: number;
  hearted: boolean;
  busy?: boolean;
  onToggle: (fileId: number) => void;
}) {
  function handleClick(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    onToggle(fileId);
  }

  return (
    <button
      id={`event-detail-photo-${fileId}-heart`}
      className="event-detail-photo-heart"
      type="button"
      aria-pressed={hearted}
      aria-label={hearted ? `取消爱心（目前 ${count} 个）` : `给这张照片点爱心（目前 ${count} 个）`}
      title={hearted ? "再按一次取消" : "点个爱心"}
      style={buttonStyle(hearted)}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={handleClick}
    >
      <i
        className={hearted ? "fa-solid fa-heart" : "fa-regular fa-heart"}
        aria-hidden="true"
        style={iconStyle(hearted)}
      />
      {count > 0 ? <span style={countStyle}>{count}</span> : null}
    </button>
  );
}

const buttonStyle = (hearted: boolean): CSSProperties => ({
  position: "absolute",
  // 底部居中：卡片 hover 会整体 scale(1.2)，贴右边的话最右一列放大后会被挤出可视范围。
  // 居中就跟卡片一起缩放，永远在画面里。
  left: "50%",
  bottom: "8px",
  transform: "translateX(-50%)",
  zIndex: 3,
  display: "inline-flex",
  alignItems: "center",
  gap: "5px",
  minHeight: "32px",
  padding: "0 10px",
  border: "none",
  borderRadius: "999px",
  // 照片深浅不定，压一层半透明黑底才保证看得见
  background: hearted ? "rgba(220, 38, 63, 0.92)" : "rgba(17, 24, 39, 0.55)",
  color: "#fff",
  fontSize: "13px",
  fontWeight: 800,
  lineHeight: 1,
  cursor: "pointer",
  backdropFilter: "blur(2px)",
  transition: "background 0.18s ease, transform 0.12s ease",
});

const iconStyle = (hearted: boolean): CSSProperties => ({
  fontSize: "15px",
  color: "#fff",
  transform: hearted ? "scale(1.08)" : "none",
  transition: "transform 0.12s ease",
});

const countStyle: CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  minWidth: "8px",
};
