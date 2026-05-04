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

function summarizeDraft(draft: PaiweiDraft) {
  const template = getTemplate(draft.code);
  const parts: string[] = [];
  if (draft.owner.trim()) {
    parts.push(`阳上：${draft.owner.trim().split(/\r?\n/)[0]}`);
  }
  if (draft.deceased.trim()) {
    parts.push(`对象：${draft.deceased.trim().split(/\r?\n/)[0]}`);
  }
  if (template.fields.quantity) {
    parts.push(`数量：${getDraftQuantity(draft)}`);
  }
  return parts.join(" · ");
}

function splitMultiInputValue(raw: string, limit = 6) {
  const values = String(raw || "")
    .split(/\r?\n/)
    .slice(0, limit);
  return values.length ? values : [""];
}

function joinMultiInputValue(values: string[], limit = 6) {
  return values
    .slice(0, limit)
    .map((value) => value.replace(/\r?\n/g, "").trim())
    .join("\n");
}

function buildPairedInputRows(leftRaw: string, rightRaw: string, limit = 3) {
  const leftValues = splitMultiInputValue(leftRaw, limit);
  const rightValues = splitMultiInputValue(rightRaw, limit);
  const rowCount = Math.min(limit, Math.max(leftValues.length, rightValues.length, 1));

  return Array.from({ length: rowCount }, (_, index) => ({
    left: leftValues[index] || "",
    right: rightValues[index] || "",
  }));
}

export function PaiweiDraftEditor(props: {
  isMobile: boolean;
  drafts: PaiweiDraft[];
  currentIndex: number | null;
  totalAmount: number;
  showSavedList?: boolean;
  onSelectIndex: (index: number | null) => void;
  onCloseEditor: () => void;
  onAddDraft: (code: PaiweiCode) => void;
  onRemoveDraft: (index: number) => void;
  onUpdateDraft: (index: number, patch: Partial<PaiweiDraft>) => void;
  onChangeDraftCode: (index: number, code: PaiweiCode) => void;
}) {
  const currentIndex =
    props.currentIndex == null ? null : Math.min(props.currentIndex, Math.max(0, props.drafts.length - 1));
  const currentDraft = currentIndex == null ? null : props.drafts[currentIndex] || null;
  const template = currentDraft ? getTemplate(currentDraft.code) : null;
  const quantity = currentDraft ? getDraftQuantity(currentDraft) : 0;
  const unitPrice = currentDraft ? getDraftUnitPrice(currentDraft) : 0;
  const totalPrice = currentDraft ? getDraftTotalPrice(currentDraft) : 0;
  const ownerValues = currentDraft && template?.fields.owner ? splitMultiInputValue(currentDraft.owner, 6) : [];
  const deceasedValues = currentDraft && template?.fields.deceased ? splitMultiInputValue(currentDraft.deceased, 3) : [];
  const deceasedRelationRows =
    currentDraft && template?.fields.deceased && template.fields.relation
      ? buildPairedInputRows(currentDraft.deceased, currentDraft.relation, 3)
      : [];

  return (
    <section className="fahui-intake__draft-section" style={sectionStyle}>
      <div style={sectionHeaderStyle}>
        <div>
          <div style={sectionTitleStyle}>牌位内容</div>
          <div style={sectionCopyStyle}>一次只填写一项，保存后可继续新增；已添加的项目会集中放在下面。</div>
        </div>
        <div style={summaryPillStyle}>合计 RM {props.totalAmount.toFixed(2)}</div>
      </div>

      <section style={addPanelStyle(props.isMobile)}>
        <div style={addPanelCopyStyle}>
          <div style={addPanelTitleStyle}>添加牌位</div>
          <div style={addPanelHintStyle}>点击后会先新增一项，默认从 A1 开始填写。</div>
        </div>

        <div style={addPanelActionStyle(props.isMobile)}>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={() => {
              props.onAddDraft("A1");
            }}
          >
            新建牌位
          </button>
        </div>
      </section>

      {props.showSavedList !== false ? (
        <section style={savedListSectionStyle}>
          <div style={savedListHeaderStyle}>
            <div style={savedListTitleStyle}>已添加牌位</div>
            <div style={savedListMetaStyle}>{props.drafts.length ? `${props.drafts.length} 项` : "暂时还没有项目"}</div>
          </div>

          {props.drafts.length ? (
            <div style={savedListStyle}>
              {props.drafts.map((draft, index) => {
                const draftTemplate = getTemplate(draft.code);
                const active = currentIndex === index;
                return (
                  <button
                    key={draft.id}
                    type="button"
                    style={savedItemCardStyle(active)}
                    onClick={() => props.onSelectIndex(index)}
                  >
                    <div style={savedItemTitleStyle}>
                      <span>{`第 ${index + 1} 项 · ${draftTemplate.title}`}</span>
                      <span>{`RM ${getDraftTotalPrice(draft).toFixed(2)}`}</span>
                    </div>
                    <div style={savedItemSummaryStyle}>{summarizeDraft(draft) || "点击查看并继续填写这项内容"}</div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={emptyStateStyle}>先从上面选择牌位类型并添加第一项。</div>
          )}
        </section>
      ) : null}

      {currentDraft && template ? (
        <article className="fahui-intake__draft-card" style={editorCardStyle}>
          <div style={editorHeaderStyle(props.isMobile)}>
            <div style={editorHeaderCopyStyle}>
              <div style={editorEyebrowStyle}>{`正在编辑第 ${currentIndex + 1} 项`}</div>
              <h3 style={editorTitleStyle}>{template.title}</h3>
              <div style={editorHintStyle}>{template.hint}</div>
            </div>

            <div style={editorActionsStyle(props.isMobile)}>
              <button type="button" style={secondaryButtonStyle} onClick={props.onCloseEditor}>
                保存这项
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
              <div style={multiInputGroupStyle}>
                {ownerValues.map((value, ownerIndex) => (
                  <div key={`${currentDraft.id}-owner-${ownerIndex}`} style={multiInputRowStyle(props.isMobile)}>
                    <input
                      style={inputStyle}
                      value={value}
                      placeholder={`阳上姓名 ${ownerIndex + 1}`}
                      onChange={(event) => {
                        const nextValues = [...ownerValues];
                        nextValues[ownerIndex] = event.target.value;
                        props.onUpdateDraft(currentIndex, { owner: joinMultiInputValue(nextValues, 6) });
                      }}
                    />
                    <button
                      type="button"
                      style={compactDangerButtonStyle}
                      onClick={() => {
                        if (ownerValues.length <= 1) {
                          props.onUpdateDraft(currentIndex, { owner: "" });
                          return;
                        }
                        const nextValues = [...ownerValues];
                        nextValues.splice(ownerIndex, 1);
                        props.onUpdateDraft(currentIndex, { owner: joinMultiInputValue(nextValues, 6) });
                      }}
                    >
                      移除
                    </button>
                  </div>
                ))}

                <div style={multiInputFooterStyle(props.isMobile)}>
                  <button
                    type="button"
                    style={compactSecondaryButtonStyle}
                    disabled={ownerValues.length >= 6}
                    onClick={() => {
                      if (ownerValues.length >= 6) {
                        return;
                      }
                      props.onUpdateDraft(currentIndex, { owner: joinMultiInputValue([...ownerValues, ""], 6) });
                    }}
                  >
                    添加阳上姓名
                  </button>
                  <span style={multiInputHintStyle}>最多 6 个</span>
                </div>
              </div>
            </label>
          ) : null}

          {template.fields.deceased && template.fields.relation ? (
            <label style={fieldStyle}>
              <span style={labelStyle}>对象资料</span>
              <div style={multiInputGroupStyle}>
                <div style={inputTableWrapStyle}>
                  <table style={inputTableStyle}>
                    <thead>
                      <tr>
                        <th style={inputTableHeadCellStyle}>关系</th>
                        <th style={inputTableHeadCellStyle}>名字</th>
                        <th style={inputTableHeadCellStyle}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deceasedRelationRows.map((row, rowIndex) => {
                        const cellStyle = inputTableCellStyle(rowIndex === deceasedRelationRows.length - 1);
                        return (
                          <tr key={`${currentDraft.id}-deceased-${rowIndex}`}>
                            <td style={cellStyle}>
                              <input
                                aria-label={`对象关系 ${rowIndex + 1}`}
                                style={inputStyle}
                                value={row.right}
                                placeholder={`关系 ${rowIndex + 1}`}
                                onChange={(event) => {
                                  const nextRows = [...deceasedRelationRows];
                                  nextRows[rowIndex] = { ...nextRows[rowIndex], right: event.target.value };
                                  props.onUpdateDraft(currentIndex, {
                                    deceased: joinMultiInputValue(
                                      nextRows.map((entry) => entry.left),
                                      3,
                                    ),
                                    relation: joinMultiInputValue(
                                      nextRows.map((entry) => entry.right),
                                      3,
                                    ),
                                  });
                                }}
                              />
                            </td>
                            <td style={cellStyle}>
                              <input
                                aria-label={`对象姓名 ${rowIndex + 1}`}
                                style={inputStyle}
                                value={row.left}
                                placeholder={`名字 ${rowIndex + 1}`}
                                onChange={(event) => {
                                  const nextRows = [...deceasedRelationRows];
                                  nextRows[rowIndex] = { ...nextRows[rowIndex], left: event.target.value };
                                  props.onUpdateDraft(currentIndex, {
                                    deceased: joinMultiInputValue(
                                      nextRows.map((entry) => entry.left),
                                      3,
                                    ),
                                    relation: joinMultiInputValue(
                                      nextRows.map((entry) => entry.right),
                                      3,
                                    ),
                                  });
                                }}
                              />
                            </td>
                            <td style={cellStyle}>
                              <button
                                type="button"
                                style={compactDangerButtonStyle}
                                onClick={() => {
                                  if (deceasedRelationRows.length <= 1) {
                                    props.onUpdateDraft(currentIndex, { deceased: "", relation: "" });
                                    return;
                                  }
                                  const nextRows = [...deceasedRelationRows];
                                  nextRows.splice(rowIndex, 1);
                                  props.onUpdateDraft(currentIndex, {
                                    deceased: joinMultiInputValue(
                                      nextRows.map((entry) => entry.left),
                                      3,
                                    ),
                                    relation: joinMultiInputValue(
                                      nextRows.map((entry) => entry.right),
                                      3,
                                    ),
                                  });
                                }}
                              >
                                移除
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div style={multiInputFooterStyle(props.isMobile)}>
                  <button
                    type="button"
                    style={compactSecondaryButtonStyle}
                    disabled={deceasedRelationRows.length >= 3}
                    onClick={() => {
                      if (deceasedRelationRows.length >= 3) {
                        return;
                      }
                      const nextRows = [...deceasedRelationRows, { left: "", right: "" }];
                      props.onUpdateDraft(currentIndex, {
                        deceased: joinMultiInputValue(
                          nextRows.map((entry) => entry.left),
                          3,
                        ),
                        relation: joinMultiInputValue(
                          nextRows.map((entry) => entry.right),
                          3,
                        ),
                      });
                    }}
                  >
                    添加对象
                  </button>
                  <span style={multiInputHintStyle}>最多 3 个</span>
                </div>
              </div>
            </label>
          ) : null}

          {template.fields.deceased && !template.fields.relation ? (
            <label style={fieldStyle}>
              <span style={labelStyle}>对象姓名</span>
              <div style={multiInputGroupStyle}>
                {deceasedValues.map((value, deceasedIndex) => (
                  <div key={`${currentDraft.id}-deceased-only-${deceasedIndex}`} style={multiInputRowStyle(props.isMobile)}>
                    <input
                      style={inputStyle}
                      value={value}
                      placeholder={`对象姓名 ${deceasedIndex + 1}`}
                      onChange={(event) => {
                        const nextValues = [...deceasedValues];
                        nextValues[deceasedIndex] = event.target.value;
                        props.onUpdateDraft(currentIndex, { deceased: joinMultiInputValue(nextValues, 3) });
                      }}
                    />
                    <button
                      type="button"
                      style={compactDangerButtonStyle}
                      onClick={() => {
                        if (deceasedValues.length <= 1) {
                          props.onUpdateDraft(currentIndex, { deceased: "" });
                          return;
                        }
                        const nextValues = [...deceasedValues];
                        nextValues.splice(deceasedIndex, 1);
                        props.onUpdateDraft(currentIndex, { deceased: joinMultiInputValue(nextValues, 3) });
                      }}
                    >
                      移除
                    </button>
                  </div>
                ))}

                <div style={multiInputFooterStyle(props.isMobile)}>
                  <button
                    type="button"
                    style={compactSecondaryButtonStyle}
                    disabled={deceasedValues.length >= 3}
                    onClick={() => {
                      if (deceasedValues.length >= 3) {
                        return;
                      }
                      props.onUpdateDraft(currentIndex, { deceased: joinMultiInputValue([...deceasedValues, ""], 3) });
                    }}
                  >
                    添加对象姓名
                  </button>
                  <span style={multiInputHintStyle}>最多 3 个</span>
                </div>
              </div>
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
      ) : props.drafts.length ? (
        <div style={emptyStateStyle}>这一页专门填写单项牌位。已保存的项目可到下一步“已添加牌位”统一查看。</div>
      ) : null}
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

function addPanelStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) auto",
    gap: "14px",
    padding: "18px",
    borderRadius: "18px",
    border: "1px solid rgba(123, 90, 56, 0.12)",
    background: "rgba(255,250,244,0.88)",
  };
}

const addPanelCopyStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
};

const addPanelTitleStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 800,
  color: "#3a2410",
};

const addPanelHintStyle: CSSProperties = {
  fontSize: "13px",
  color: "#7a5e42",
  lineHeight: 1.6,
};

function addPanelActionStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: isMobile ? "stretch" : "flex-end",
    alignItems: "center",
  };
}

const savedListSectionStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

const savedListHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
  flexWrap: "wrap",
};

const savedListTitleStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 800,
  color: "#3a2410",
};

const savedListMetaStyle: CSSProperties = {
  fontSize: "13px",
  color: "#7a5e42",
};

const savedListStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

function savedItemCardStyle(active: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "6px",
    width: "100%",
    padding: "16px",
    borderRadius: "16px",
    border: active ? "1px solid #a66a2e" : "1px solid rgba(123, 90, 56, 0.12)",
    background: active ? "rgba(255,248,237,0.98)" : "#fffdfa",
    textAlign: "left",
    cursor: "pointer",
  };
}

const savedItemTitleStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
  fontSize: "14px",
  fontWeight: 800,
  color: "#3a2410",
};

const savedItemSummaryStyle: CSSProperties = {
  fontSize: "12px",
  color: "#75583b",
  lineHeight: 1.6,
};

const emptyStateStyle: CSSProperties = {
  padding: "18px",
  borderRadius: "14px",
  border: "1px dashed rgba(123, 90, 56, 0.22)",
  color: "#7a5e42",
  fontSize: "13px",
  lineHeight: 1.6,
  background: "rgba(250,246,239,0.75)",
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

const multiInputGroupStyle: CSSProperties = {
  display: "grid",
  gap: "10px",
};

function multiInputRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) auto",
    gap: "10px",
    alignItems: "center",
  };
}

function multiInputFooterStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: isMobile ? "column" : "row",
    alignItems: isMobile ? "stretch" : "center",
    gap: "10px",
  };
}

const multiInputHintStyle: CSSProperties = {
  fontSize: "12px",
  color: "#7a5e42",
  lineHeight: 1.6,
};

const inputTableWrapStyle: CSSProperties = {
  overflowX: "auto",
  borderRadius: "16px",
  border: "1px solid rgba(123, 90, 56, 0.12)",
  background: "#fffdfa",
};

const inputTableStyle: CSSProperties = {
  width: "100%",
  minWidth: "540px",
  borderCollapse: "collapse",
};

const inputTableHeadCellStyle: CSSProperties = {
  textAlign: "left",
  padding: "12px 14px",
  background: "rgba(247,240,230,0.68)",
  color: "#7a5e42",
  fontSize: "12px",
  fontWeight: 800,
  borderBottom: "1px solid rgba(123, 90, 56, 0.12)",
};

function inputTableCellStyle(isLastRow: boolean): CSSProperties {
  return {
    padding: "12px 14px",
    verticalAlign: "middle",
    borderBottom: isLastRow ? "none" : "1px solid rgba(123, 90, 56, 0.1)",
  };
}

const primaryButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: "14px",
  background: "linear-gradient(135deg, #ba7330, #8f5624)",
  color: "#fff8ef",
  padding: "12px 18px",
  fontSize: "14px",
  fontWeight: 800,
  cursor: "pointer",
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

const compactSecondaryButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  padding: "10px 14px",
  fontSize: "13px",
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

const compactDangerButtonStyle: CSSProperties = {
  ...dangerButtonStyle,
  padding: "10px 14px",
  fontSize: "13px",
};
