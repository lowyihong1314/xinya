import { useEffect, useState, type CSSProperties } from "react";

import { previewYlpPaiweiImages } from "./api";
import { paiweiTitleForCode } from "./intake/paiwei";
import type { YlpPaiweiTablet } from "./types";

// 牌位预览的唯一实现：后端把牌位 PDF 逐张裁成 JPEG，这里排成网格。
// 以前订单详情 / 列表行 / 公开分享页是把整份 PDF 塞进 <iframe>，
// iOS Safari 基本渲染不了，手机上等于看不到；现在五个入口统一走这里。
export function PaiweiPreviewGrid({
  orderIds,
  minTileWidth = 140,
  showOrderId,
  emptyText = "没有可预览的牌位。",
  onLoaded,
}: {
  orderIds: number[];
  /** 抽屉窄，给小一点；整页宽，给大一点 */
  minTileWidth?: number;
  /** 一次看多张订单时把订单号标出来；默认按订单数量自动决定 */
  showOrderId?: boolean;
  emptyText?: string;
  onLoaded?: (count: number) => void;
}) {
  const [tablets, setTablets] = useState<YlpPaiweiTablet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 依赖用字符串而不是数组本身：调用方多半是行内 [orderId]，每次 render 都是新数组
  const key = orderIds.join(",");

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(",").map(Number).filter(Boolean) : [];
    if (!ids.length) {
      setTablets([]);
      setError("");
      return undefined;
    }

    setLoading(true);
    setError("");
    void (async () => {
      try {
        const res = await previewYlpPaiweiImages(ids);
        if (cancelled) return;
        const list = res.data?.tablets || [];
        setTablets(list);
        if (!list.length) {
          setError(res.message || emptyText);
        }
        onLoaded?.(list.length);
      } catch (nextError) {
        if (!cancelled) {
          setTablets([]);
          setError(nextError instanceof Error ? nextError.message : "生成预览失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // onLoaded 故意不进依赖：调用方常传行内函数，进了会每次都重新拉图
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, emptyText]);

  // 只有第一次（还没有图）才整块换成「生成中」。换订单时留着旧图淡显，
  // 新图回来直接顶掉 —— 抽屉里连着看好几张订单时不会一闪一闪的。
  if (loading && !tablets.length) {
    return <p style={stateStyle}>正在生成预览图…</p>;
  }
  if (error && !tablets.length) {
    return <p style={stateStyle}>{error}</p>;
  }
  if (!tablets.length) {
    return <p style={stateStyle}>{emptyText}</p>;
  }

  const withOrderId = showOrderId ?? new Set(tablets.map((tablet) => tablet.order_id)).size > 1;

  return (
    <div
      style={{
        ...gridStyle,
        gridTemplateColumns: `repeat(auto-fill, minmax(${minTileWidth}px, 1fr))`,
        opacity: loading ? 0.4 : 1,
        transition: "opacity 0.15s ease",
      }}
    >
      {tablets.map((tablet, index) => (
        <div key={`${tablet.order_id}-${tablet.item_id ?? index}`} style={cardStyle}>
          <img
            src={tablet.image}
            alt={`${paiweiTitleForCode(tablet.code)}（订单 ${tablet.order_id}）`}
            style={imageStyle}
          />
          <span style={captionStyle}>
            {paiweiTitleForCode(tablet.code)}
            {withOrderId ? ` · #${tablet.order_id}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

const gridStyle: CSSProperties = { display: "grid", gap: "10px" };
const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  padding: "8px",
  borderRadius: "10px",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line)",
};
const imageStyle: CSSProperties = {
  width: "100%",
  height: "auto",
  display: "block",
  borderRadius: "6px",
  background: "#fff",
};
const captionStyle: CSSProperties = {
  fontSize: "11px",
  fontWeight: 600,
  textAlign: "center",
  color: "var(--x-color-ink-muted)",
};
const stateStyle: CSSProperties = {
  margin: 0,
  padding: "12px",
  textAlign: "center",
  fontSize: "12.5px",
  color: "var(--x-color-ink-muted)",
};
