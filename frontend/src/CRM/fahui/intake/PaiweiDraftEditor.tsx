import type { CSSProperties } from "react";

import {
  PAIWEI_TEMPLATES,
  type PaiweiCode,
  type PaiweiDraft,
  getDraftQuantity,
  getDraftTotalPrice,
  getDraftUnitPrice,
  getTemplate,
} from "./paiwei";

export function PaiweiDraftEditor(props: {
  isMobile: boolean;
  drafts: PaiweiDraft[];
  currentIndex: number;
  totalAmount: number;
  onSelectIndex: (index: number) => void;
  onAddDraft: (code: PaiweiCode) => void;
  onRemoveDraft: (index: number) => void;
  onUpdateDraft: (index: number, patch: Partial<PaiweiDraft>) => void;
  onChangeDraftCode: (index: number, code: PaiweiCode) => void;
}) {
  const currentDraft = props.drafts[props.currentIndex] || props.drafts[0];
  const currentIndex = Math.min(props.currentIndex, props.drafts.length - 1);
  const template = getTemplate(currentDraft.code);
  const quantity = getDraftQuantity(currentDraft);
  const unitPrice = getDraftUnitPrice(currentDraft);
  const totalPrice = getDraftTotalPrice(currentDraft);

  return (
    <section className="fahui-intake__draft-section" style={sectionStyle}>
      <div style={sectionHeaderStyle}>
        <div>
          <div style={sectionTitleStyle}>牌位内容</div>
          <div style={sectionCopyStyle}>请按顺序逐项填写；如有多项，可用上一项 / 下一项切换。</div>
        </div>
        <div style={summaryPillStyle}>合计 RM {props.totalAmount.toFixed(2)}</div>
      </div>

      <div style={templateGridStyle(props.isMobile)}>
        {PAIWEI_TEMPLATES.map((item) => (
          <button
            key={item.code}
            type="button"
            style={templateCardStyle}
            title={item.hint}
            onClick={() => props.onAddDraft(item.code)}
          >
            <div style={templateCodeStyle}>{item.code}</div>
            <div style={templateTitleStyle}>{item.title}</div>
            <div style={templateMetaStyle}>新增这一项 · RM {item.price}</div>
          </button>
        ))}
      </div>

      <div style={draftTabRowStyle}>
        {props.drafts.map((draft, index) => {
          const draftTemplate = getTemplate(draft.code);
          const active = index === currentIndex;
          return (
            <button
              key={draft.id}
              type="button"
              style={draftTabStyle(active)}
              onClick={() => props.onSelectIndex(index)}
            >
              <span style={draftTabCountStyle}>{`第 ${index + 1} 项`}</span>
              <span style={draftTabTitleStyle}>{draftTemplate.code}</span>
            </button>
          );
        })}
      </div>

      <article className="fahui-intake__draft-card" style={editorCardStyle}>
        <div style={editorHeaderStyle(props.isMobile)}>
          <div style={editorHeaderCopyStyle}>
            <div style={editorEyebrowStyle}>{`第 ${currentIndex + 1} 项 / 共 ${props.drafts.length} 项`}</div>
            <h3 style={editorTitleStyle}>{template.title}</h3>
            <div style={editorHintStyle}>{template.hint}</div>
          </div>

          <div style={editorActionsStyle(props.isMobile)}>
            <button
              type="button"
              style={secondaryButtonStyle}
              disabled={currentIndex === 0}
              onClick={() => props.onSelectIndex(currentIndex - 1)}
            >
              上一项
            </button>
            <button
              type="button"
              style={secondaryButtonStyle}
              disabled={currentIndex >= props.drafts.length - 1}
              onClick={() => props.onSelectIndex(currentIndex + 1)}
            >
              下一项
            </button>
            <button type="button" style={dangerButtonStyle} onClick={() => props.onRemoveDraft(currentIndex)}>
              移除本项
            </button>
          </div>
        </div>

        <div style={priceSummaryStyle(props.isMobile)}>
          <div style={priceSummaryCardStyle}>
            <div style={priceLabelStyle}>单价</div>
            <div style={priceValueStyle}>RM {unitPrice.toFixed(2)}</div>
          </div>
          <div style={priceSummaryCardStyle}>
            <div style={priceLabelStyle}>数量</div>
            <div style={priceValueStyle}>{quantity}</div>
          </div>
          <div style={priceSummaryCardStyle}>
            <div style={priceLabelStyle}>本项金额</div>
            <div style={priceValueStyle}>RM {totalPrice.toFixed(2)}</div>
          </div>
        </div>

        <div style={fieldGridStyle(props.isMobile)}>
          <label style={fieldStyle}>
            <span style={labelStyle}>牌位类型</span>
            <select
              style={inputStyle}
              value={currentDraft.code}
              onChange={(event) => props.onChangeDraftCode(currentIndex, event.target.value as PaiweiCode)}
            >
              {PAIWEI_TEMPLATES.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code} · {item.title}
                </option>
              ))}
            </select>
          </label>

          {template.fields.quantity ? (
            <label style={fieldStyle}>
              <span style={labelStyle}>数量</span>
              <input
                style={inputStyle}
                type="number"
                min="1"
                inputMode="numeric"
                value={currentDraft.quantity}
                onChange={(event) => props.onUpdateDraft(currentIndex, { quantity: event.target.value })}
              />
            </label>
          ) : null}

          {template.fields.surname ? (
            <label style={fieldStyle}>
              <span style={labelStyle}>姓氏</span>
              <input
                style={inputStyle}
                value={currentDraft.surname}
                onChange={(event) => props.onUpdateDraft(currentIndex, { surname: event.target.value })}
              />
            </label>
          ) : null}

          {template.fields.suffix ? (
            <label style={fieldStyle}>
              <span style={labelStyle}>内容 / 堂号</span>
              <input
                style={inputStyle}
                value={currentDraft.suffix}
                onChange={(event) => props.onUpdateDraft(currentIndex, { suffix: event.target.value })}
              />
            </label>
          ) : null}

          {template.fields.father ? (
            <label style={fieldStyle}>
              <span style={labelStyle}>父名</span>
              <input
                style={inputStyle}
                value={currentDraft.father}
                onChange={(event) => props.onUpdateDraft(currentIndex, { father: event.target.value })}
              />
            </label>
          ) : null}

          {template.fields.mother ? (
            <label style={fieldStyle}>
              <span style={labelStyle}>母名</span>
              <input
                style={inputStyle}
                value={currentDraft.mother}
                onChange={(event) => props.onUpdateDraft(currentIndex, { mother: event.target.value })}
              />
            </label>
          ) : null}
        </div>

        {template.fields.owner ? (
          <label style={fieldStyle}>
            <span style={labelStyle}>阳上姓名</span>
            <textarea
              style={textareaStyle}
              value={currentDraft.owner}
              placeholder="多人请分行填写"
              onChange={(event) => props.onUpdateDraft(currentIndex, { owner: event.target.value })}
            />
          </label>
        ) : null}

        {template.fields.deceased ? (
          <label style={fieldStyle}>
            <span style={labelStyle}>对象姓名</span>
            <textarea
              style={textareaStyle}
              value={currentDraft.deceased}
              placeholder="多人请分行填写"
              onChange={(event) => props.onUpdateDraft(currentIndex, { deceased: event.target.value })}
            />
          </label>
        ) : null}

        {template.fields.relation ? (
          <label style={fieldStyle}>
            <span style={labelStyle}>与对象关系</span>
            <textarea
              style={textareaStyle}
              value={currentDraft.relation}
              placeholder="如有多人，请分行对应填写"
              onChange={(event) => props.onUpdateDraft(currentIndex, { relation: event.target.value })}
            />
          </label>
        ) : null}

        <label style={fieldStyle}>
          <span style={labelStyle}>附注（选填）</span>
          <textarea
            style={textareaStyle}
            value={currentDraft.note}
            placeholder="如有需要补充说明，可填在这里"
            onChange={(event) => props.onUpdateDraft(currentIndex, { note: event.target.value })}
          />
        </label>
      </article>
    </section>
  );
}

const sectionStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "start",
  gap: "12px",
  flexWrap: "wrap",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: "20px",
  fontWeight: 800,
  color: "#3f2a16",
};

const sectionCopyStyle: CSSProperties = {
  marginTop: "4px",
  color: "#7a5e42",
  fontSize: "13px",
  lineHeight: 1.6,
};

const summaryPillStyle: CSSProperties = {
  alignSelf: "start",
  padding: "10px 14px",
  borderRadius: "999px",
  background: "rgba(166,106,46,0.08)",
  color: "#6f4d2e",
  fontSize: "13px",
  fontWeight: 800,
};

function templateGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))",
    gap: "12px",
  };
}

const templateCardStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
  padding: "14px",
  borderRadius: "16px",
  border: "1px solid rgba(123, 90, 56, 0.12)",
  background: "#fffdfa",
  cursor: "pointer",
  textAlign: "left",
};

const templateCodeStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 800,
  color: "#a66a2e",
};

const templateTitleStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  color: "#3a2410",
  lineHeight: 1.5,
};

const templateMetaStyle: CSSProperties = {
  fontSize: "12px",
  color: "#7a5e42",
};

const draftTabRowStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  overflowX: "auto",
  paddingBottom: "4px",
};

function draftTabStyle(active: boolean): CSSProperties {
  return {
    minWidth: "86px",
    display: "grid",
    gap: "4px",
    padding: "12px 14px",
    borderRadius: "14px",
    border: active ? "1px solid #a66a2e" : "1px solid rgba(123, 90, 56, 0.12)",
    background: active ? "rgba(255,248,237,0.98)" : "#fffdfa",
    color: active ? "#8f5624" : "#6c5338",
    cursor: "pointer",
    textAlign: "left",
    flexShrink: 0,
  };
}

const draftTabCountStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
};

const draftTabTitleStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 800,
};

const editorCardStyle: CSSProperties = {
  display: "grid",
  gap: "16px",
  padding: "22px",
  borderRadius: "22px",
  border: "1px solid rgba(123, 90, 56, 0.12)",
  background: "#fffdfa",
  boxShadow: "0 14px 36px rgba(77, 49, 22, 0.06)",
};

function editorHeaderStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: isMobile ? "column" : "row",
    justifyContent: "space-between",
    alignItems: isMobile ? "stretch" : "start",
    gap: "14px",
  };
}

const editorHeaderCopyStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const editorEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "#a66a2e",
};

const editorTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "24px",
  lineHeight: 1.15,
  color: "#3a2410",
};

const editorHintStyle: CSSProperties = {
  fontSize: "14px",
  color: "#75583b",
  lineHeight: 1.6,
};

function editorActionsStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: isMobile ? "column" : "row",
    gap: "10px",
    alignItems: isMobile ? "stretch" : "center",
  };
}

function priceSummaryStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
    gap: "12px",
  };
}

const priceSummaryCardStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
  padding: "14px 16px",
  borderRadius: "16px",
  background: "rgba(248, 241, 231, 0.9)",
  border: "1px solid rgba(123, 90, 56, 0.1)",
};

const priceLabelStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 700,
  color: "#7a5e42",
};

const priceValueStyle: CSSProperties = {
  fontSize: "20px",
  fontWeight: 800,
  color: "#3a2410",
};

function fieldGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
    gap: "14px",
  };
}

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: "6px",
};

const labelStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 700,
  color: "#5d462f",
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  borderRadius: "14px",
  border: "1px solid rgba(123, 90, 56, 0.18)",
  background: "#fffdfa",
  padding: "12px 14px",
  fontSize: "14px",
  color: "#342112",
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "96px",
  resize: "vertical",
};

const secondaryButtonStyle: CSSProperties = {
  border: "1px solid rgba(123, 90, 56, 0.18)",
  borderRadius: "14px",
  background: "#fffdfa",
  color: "#5c442c",
  padding: "12px 18px",
  fontSize: "14px",
  fontWeight: 700,
  cursor: "pointer",
};

const dangerButtonStyle: CSSProperties = {
  border: "1px solid rgba(176, 63, 42, 0.18)",
  borderRadius: "14px",
  background: "rgba(255,244,241,0.96)",
  color: "#ad3e2a",
  padding: "12px 18px",
  fontSize: "14px",
  fontWeight: 700,
  cursor: "pointer",
};
