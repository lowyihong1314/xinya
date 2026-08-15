import type { CSSProperties } from "react";

import { buttonSecondaryStyle, inputStyle } from "./claimStyles";
import {
  autoLineAmount,
  lineItemsTotal,
  makeLineItemDraft,
  toNumber,
  type LineItemDraft,
} from "./lineItems";

// 报销单的「用途明细」表：一行一项，合计即整单金额（新建 / 批量 / 详情编辑共用）。
export function LineItemsEditor({
  isMobile,
  lines,
  onChange,
  readOnly = false,
}: {
  isMobile: boolean;
  lines: LineItemDraft[];
  onChange: (next: LineItemDraft[]) => void;
  readOnly?: boolean;
}) {
  const total = lineItemsTotal(lines);

  function patchLine(key: string, patch: Partial<LineItemDraft>) {
    onChange(
      lines.map((line) => {
        if (line.key !== key) return line;
        const next = { ...line, ...patch };
        // 数量/单价一改就自动补小计，手填金额时不覆盖
        if ("quantity" in patch || "unit_price" in patch) {
          next.amount = autoLineAmount(next);
        }
        return next;
      }),
    );
  }

  function addLine() {
    onChange([...lines, makeLineItemDraft()]);
  }

  function removeLine(key: string) {
    const next = lines.filter((line) => line.key !== key);
    onChange(next.length ? next : [makeLineItemDraft()]);
  }

  function moveLine(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= lines.length) return;
    const next = [...lines];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="claim-line-items" style={wrapStyle}>
      {!isMobile ? (
        <div style={headRowStyle}>
          <span style={colNoStyle}>#</span>
          <span>项目说明</span>
          <span style={colNumStyle}>数量</span>
          <span style={colNumStyle}>单价</span>
          <span style={colNumStyle}>小计 RM</span>
          <span style={colActionStyle} />
        </div>
      ) : null}

      {lines.map((line, index) => (
        <div key={line.key} style={isMobile ? mobileRowStyle : rowStyle}>
          <span style={isMobile ? mobileNoStyle : colNoStyle}>{index + 1}</span>
          <input
            style={{ ...inputStyle, minWidth: 0 }}
            value={line.description}
            placeholder="买了什么 / 用在哪里"
            disabled={readOnly}
            onChange={(event) => patchLine(line.key, { description: event.target.value })}
          />
          <input
            style={{ ...inputStyle, minWidth: 0, ...(isMobile ? {} : colNumStyle) }}
            inputMode="decimal"
            value={line.quantity}
            placeholder={isMobile ? "数量" : ""}
            disabled={readOnly}
            onChange={(event) => patchLine(line.key, { quantity: event.target.value })}
          />
          <input
            style={{ ...inputStyle, minWidth: 0, ...(isMobile ? {} : colNumStyle) }}
            inputMode="decimal"
            value={line.unit_price}
            placeholder={isMobile ? "单价" : ""}
            disabled={readOnly}
            onChange={(event) => patchLine(line.key, { unit_price: event.target.value })}
          />
          <input
            style={{ ...inputStyle, minWidth: 0, fontWeight: 700, ...(isMobile ? {} : colNumStyle) }}
            inputMode="decimal"
            value={line.amount}
            placeholder={isMobile ? "小计 RM" : ""}
            disabled={readOnly}
            onChange={(event) => patchLine(line.key, { amount: event.target.value })}
          />
          {readOnly ? null : (
            <span style={colActionStyle}>
              <button type="button" style={iconButtonStyle} title="上移" disabled={index === 0} onClick={() => moveLine(index, -1)}>
                ↑
              </button>
              <button
                type="button"
                style={iconButtonStyle}
                title="下移"
                disabled={index === lines.length - 1}
                onClick={() => moveLine(index, 1)}
              >
                ↓
              </button>
              <button type="button" style={{ ...iconButtonStyle, color: "var(--x-color-danger)" }} title="删除此行" onClick={() => removeLine(line.key)}>
                ×
              </button>
            </span>
          )}
        </div>
      ))}

      <div style={footRowStyle}>
        {readOnly ? (
          <span />
        ) : (
          <button type="button" style={buttonSecondaryStyle} onClick={addLine}>
            + 添加一行
          </button>
        )}
        <span style={totalStyle}>
          明细合计
          <strong style={totalValueStyle}>RM {total.toFixed(2)}</strong>
          <span style={totalHintStyle}>（整单金额以此为准）</span>
        </span>
      </div>
    </div>
  );
}

/** 只读展示（详情页非编辑态）。 */
export function LineItemsTable({ lines, isMobile }: { lines: LineItemDraft[]; isMobile: boolean }) {
  const total = lineItemsTotal(lines);
  return (
    <div className="claim-line-items claim-line-items--readonly" style={wrapStyle}>
      {lines.map((line, index) => (
        <div key={line.key} style={isMobile ? readonlyMobileRowStyle : readonlyRowStyle}>
          <span style={colNoStyle}>{index + 1}</span>
          <span style={readonlyDescStyle}>
            {line.description}
            {line.category ? <span style={categoryChipStyle}>{line.category}</span> : null}
          </span>
          <span style={readonlyQtyStyle}>
            {String(line.quantity).trim() ? `x${toNumber(line.quantity)}` : ""}
            {String(line.unit_price).trim() ? ` @ ${toNumber(line.unit_price).toFixed(2)}` : ""}
          </span>
          <span style={readonlyAmountStyle}>RM {toNumber(line.amount).toFixed(2)}</span>
        </div>
      ))}
      <div style={footRowStyle}>
        <span />
        <span style={totalStyle}>
          合计
          <strong style={totalValueStyle}>RM {total.toFixed(2)}</strong>
        </span>
      </div>
    </div>
  );
}

const wrapStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  padding: "10px",
  borderRadius: "10px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-alt)",
};
const gridColumns = "24px minmax(0, 1fr) 72px 84px 96px 88px";
const headRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridColumns,
  gap: "6px",
  alignItems: "center",
  fontSize: "11.5px",
  fontWeight: 800,
  color: "var(--x-color-ink-muted)",
  padding: "0 2px",
};
const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: gridColumns,
  gap: "6px",
  alignItems: "center",
};
const mobileRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "20px minmax(0, 1fr)",
  gap: "6px",
  alignItems: "center",
  padding: "8px",
  borderRadius: "8px",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line-soft)",
};
const mobileNoStyle: CSSProperties = { fontSize: "12px", fontWeight: 800, color: "var(--x-color-ink-muted)" };
const colNoStyle: CSSProperties = { fontSize: "12px", fontWeight: 700, color: "var(--x-color-ink-muted)", textAlign: "center" };
const colNumStyle: CSSProperties = { textAlign: "right" };
const colActionStyle: CSSProperties = { display: "flex", gap: "2px", justifyContent: "flex-end" };
const iconButtonStyle: CSSProperties = {
  width: 24,
  height: 26,
  padding: 0,
  borderRadius: "6px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  cursor: "pointer",
};
const footRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
  flexWrap: "wrap",
  paddingTop: "4px",
  borderTop: "1px dashed var(--x-color-line)",
};
const totalStyle: CSSProperties = { display: "inline-flex", alignItems: "baseline", gap: "6px", fontSize: "12.5px", fontWeight: 700, color: "var(--x-color-ink-muted)" };
const totalValueStyle: CSSProperties = { fontSize: "16px", fontWeight: 800, color: "var(--x-color-ink)" };
const totalHintStyle: CSSProperties = { fontSize: "11px", fontWeight: 500 };
const readonlyRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "24px minmax(0, 1fr) 120px 100px",
  gap: "6px",
  alignItems: "baseline",
  fontSize: "13px",
};
const readonlyMobileRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "20px minmax(0, 1fr) 92px",
  gap: "6px",
  alignItems: "baseline",
  fontSize: "13px",
};
const readonlyDescStyle: CSSProperties = { whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--x-color-ink)" };
const readonlyQtyStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", textAlign: "right" };
const readonlyAmountStyle: CSSProperties = { fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" };
const categoryChipStyle: CSSProperties = {
  marginLeft: "6px",
  padding: "1px 7px",
  borderRadius: "999px",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line-soft)",
  fontSize: "11px",
  color: "var(--x-color-ink-muted)",
};
