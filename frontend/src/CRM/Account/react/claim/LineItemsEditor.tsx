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
    <div className="claim-line-items" style={isMobile ? mobileWrapStyle : wrapStyle}>
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

      {lines.map((line, index) =>
        isMobile ? (
          // 手机：一行一张卡。以前是两列网格塞六个格子，数量和小计会掉进 20px 宽的序号列里，
          // 手指根本点不中，所以说明单独占一行，三个数字并排各占三分之一。
          <div key={line.key} style={mobileCardStyle}>
            <div style={mobileHeadStyle}>
              <span style={mobileNoStyle}>第 {index + 1} 项</span>
              {readOnly ? null : (
                <span style={mobileActionsStyle}>
                  <button
                    type="button"
                    style={mobileIconButtonStyle}
                    title="上移"
                    aria-label="上移"
                    disabled={index === 0}
                    onClick={() => moveLine(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    style={mobileIconButtonStyle}
                    title="下移"
                    aria-label="下移"
                    disabled={index === lines.length - 1}
                    onClick={() => moveLine(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    style={{ ...mobileIconButtonStyle, color: "var(--x-color-danger)" }}
                    title="删除此行"
                    aria-label="删除此行"
                    onClick={() => removeLine(line.key)}
                  >
                    ×
                  </button>
                </span>
              )}
            </div>

            <input
              style={mobileInputStyle}
              value={line.description}
              placeholder="买了什么 / 用在哪里"
              disabled={readOnly}
              onChange={(event) => patchLine(line.key, { description: event.target.value })}
            />

            <div style={mobileNumberGridStyle}>
              <label style={mobileNumberFieldStyle}>
                <span style={mobileNumberLabelStyle}>数量</span>
                <input
                  style={{ ...mobileInputStyle, textAlign: "right" }}
                  inputMode="decimal"
                  value={line.quantity}
                  disabled={readOnly}
                  onChange={(event) => patchLine(line.key, { quantity: event.target.value })}
                />
              </label>
              <label style={mobileNumberFieldStyle}>
                <span style={mobileNumberLabelStyle}>单价</span>
                <input
                  style={{ ...mobileInputStyle, textAlign: "right" }}
                  inputMode="decimal"
                  value={line.unit_price}
                  disabled={readOnly}
                  onChange={(event) => patchLine(line.key, { unit_price: event.target.value })}
                />
              </label>
              <label style={mobileNumberFieldStyle}>
                <span style={mobileNumberLabelStyle}>小计 RM</span>
                <input
                  style={{ ...mobileInputStyle, textAlign: "right", fontWeight: 700 }}
                  inputMode="decimal"
                  value={line.amount}
                  disabled={readOnly}
                  onChange={(event) => patchLine(line.key, { amount: event.target.value })}
                />
              </label>
            </div>
          </div>
        ) : (
          <div key={line.key} style={rowStyle}>
            <span style={colNoStyle}>{index + 1}</span>
            <input
              style={{ ...inputStyle, minWidth: 0 }}
              value={line.description}
              placeholder="买了什么 / 用在哪里"
              disabled={readOnly}
              onChange={(event) => patchLine(line.key, { description: event.target.value })}
            />
            <input
              style={{ ...inputStyle, minWidth: 0, ...colNumStyle }}
              inputMode="decimal"
              value={line.quantity}
              disabled={readOnly}
              onChange={(event) => patchLine(line.key, { quantity: event.target.value })}
            />
            <input
              style={{ ...inputStyle, minWidth: 0, ...colNumStyle }}
              inputMode="decimal"
              value={line.unit_price}
              disabled={readOnly}
              onChange={(event) => patchLine(line.key, { unit_price: event.target.value })}
            />
            <input
              style={{ ...inputStyle, minWidth: 0, fontWeight: 700, ...colNumStyle }}
              inputMode="decimal"
              value={line.amount}
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
        ),
      )}

      <div style={isMobile ? mobileFootStyle : footRowStyle}>
        {readOnly ? (
          isMobile ? null : <span />
        ) : (
          <button
            type="button"
            style={isMobile ? { ...buttonSecondaryStyle, width: "100%", minHeight: "42px" } : buttonSecondaryStyle}
            onClick={addLine}
          >
            + 添加一行
          </button>
        )}
        <span style={isMobile ? mobileTotalStyle : totalStyle}>
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
      {lines.map((line, index) => {
        const qtyText = `${String(line.quantity).trim() ? `x${toNumber(line.quantity)}` : ""}${
          String(line.unit_price).trim() ? ` @ ${toNumber(line.unit_price).toFixed(2)}` : ""
        }`;
        // 手机：序号 + 说明一行，数量与金额另起一行左右分开，
        // 不再让金额落到 20px 宽的序号列里被压扁。
        return isMobile ? (
          <div key={line.key} style={readonlyMobileRowStyle}>
            <span style={colNoStyle}>{index + 1}</span>
            <div style={readonlyMobileBodyStyle}>
              <span style={readonlyDescStyle}>
                {line.description}
                {line.category ? <span style={categoryChipStyle}>{line.category}</span> : null}
              </span>
              <div style={readonlyMobileMetaStyle}>
                <span style={readonlyQtyStyle}>{qtyText}</span>
                <span style={readonlyAmountStyle}>RM {toNumber(line.amount).toFixed(2)}</span>
              </div>
            </div>
          </div>
        ) : (
          <div key={line.key} style={readonlyRowStyle}>
            <span style={colNoStyle}>{index + 1}</span>
            <span style={readonlyDescStyle}>
              {line.description}
              {line.category ? <span style={categoryChipStyle}>{line.category}</span> : null}
            </span>
            <span style={readonlyQtyStyle}>{qtyText}</span>
            <span style={readonlyAmountStyle}>RM {toNumber(line.amount).toFixed(2)}</span>
          </div>
        );
      })}
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
// 手机上卡片自己就是容器了，外面这层边框和内边距只会白白吃掉左右宽度。
const mobileWrapStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
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
const mobileCardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  padding: "10px",
  borderRadius: "10px",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line-soft)",
};
const mobileHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
};
const mobileNoStyle: CSSProperties = { fontSize: "12px", fontWeight: 800, color: "var(--x-color-ink-muted)" };
const mobileActionsStyle: CSSProperties = { display: "flex", gap: "6px" };
// 16px 是 iOS 的门槛：再小一点 Safari 会在聚焦时自动放大整页，填完一行要手动缩回去。
const mobileInputStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "42px",
  fontSize: "16px",
  padding: "8px 10px",
};
const mobileNumberGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: "8px",
};
const mobileNumberFieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 };
const mobileNumberLabelStyle: CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
};
const mobileIconButtonStyle: CSSProperties = {
  width: 34,
  height: 34,
  padding: 0,
  borderRadius: "8px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  fontSize: "15px",
  lineHeight: 1,
  cursor: "pointer",
};
const mobileFootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: "10px",
  paddingTop: "8px",
  borderTop: "1px dashed var(--x-color-line)",
};
const mobileTotalStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "flex-end",
  flexWrap: "wrap",
  gap: "6px",
  fontSize: "12.5px",
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
};
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
  gridTemplateColumns: "20px minmax(0, 1fr)",
  gap: "6px",
  alignItems: "baseline",
  fontSize: "13px",
  padding: "6px 0",
  borderBottom: "1px solid var(--x-color-line-soft)",
};
const readonlyMobileBodyStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 };
const readonlyMobileMetaStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "8px",
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
