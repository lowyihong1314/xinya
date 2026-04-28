import { getMaxZIndex } from "../../get_Max_zindex.js";
import { openFlowModal } from "./flow.js";
import { fmtDateTime, isFormRegistrationClosed } from "./utils.js";

function getLatestEvent(form) {
  return Array.isArray(form?.events) && form.events.length
    ? form.events[form.events.length - 1]
    : null;
}

function createSection(title, description = "") {
  const section = document.createElement("section");
  Object.assign(section.style, {
    display: "grid",
    gap: "10px",
    padding: "14px",
    borderRadius: "14px",
    background: "rgba(255,255,255,.74)",
    border: "1px solid rgba(15,23,42,.08)",
  });

  const heading = document.createElement("div");
  Object.assign(heading.style, {
    display: "grid",
    gap: "4px",
  });

  const titleEl = document.createElement("div");
  titleEl.textContent = title;
  Object.assign(titleEl.style, {
    fontWeight: "900",
    fontSize: "15px",
    color: "#0f172a",
  });

  heading.appendChild(titleEl);

  if (description) {
    const copy = document.createElement("div");
    copy.textContent = description;
    Object.assign(copy.style, {
      fontSize: "12px",
      lineHeight: "1.6",
      color: "#475569",
    });
    heading.appendChild(copy);
  }

  section.appendChild(heading);
  return section;
}

function createFactGrid() {
  const grid = document.createElement("div");
  Object.assign(grid.style, {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "10px",
  });
  return grid;
}

function createFact(label, value) {
  const card = document.createElement("div");
  Object.assign(card.style, {
    padding: "12px",
    borderRadius: "12px",
    background: "rgba(248,250,252,.92)",
    border: "1px solid rgba(15,23,42,.06)",
    display: "grid",
    gap: "6px",
  });

  const labelEl = document.createElement("div");
  labelEl.textContent = label;
  Object.assign(labelEl.style, {
    fontSize: "12px",
    fontWeight: "800",
    color: "#64748b",
  });

  const valueEl = document.createElement("div");
  valueEl.textContent = value || "—";
  Object.assign(valueEl.style, {
    fontSize: "14px",
    lineHeight: "1.6",
    color: "#0f172a",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  });

  card.append(labelEl, valueEl);
  return card;
}

function createBulletList(items) {
  const list = document.createElement("div");
  Object.assign(list.style, {
    display: "grid",
    gap: "8px",
  });

  items.forEach((item) => {
    const row = document.createElement("div");
    row.textContent = `• ${item}`;
    Object.assign(row.style, {
      fontSize: "13px",
      lineHeight: "1.6",
      color: "#334155",
      whiteSpace: "pre-wrap",
    });
    list.appendChild(row);
  });

  return list;
}

function buildFeeLine(fee) {
  const category = String(fee?.category || "未命名收费");
  const amount = Number(fee?.amount || 0);
  const desc = String(fee?.description || "").trim();
  const ageParts = [];
  if (fee?.age_range_from !== null && fee?.age_range_from !== undefined && fee?.age_range_from !== "") {
    ageParts.push(`${fee.age_range_from}+`);
  }
  if (fee?.age_range_to !== null && fee?.age_range_to !== undefined && fee?.age_range_to !== "") {
    ageParts.push(`≤${fee.age_range_to}`);
  }

  const parts = [`${category} · RM ${amount.toFixed(2)}`];
  if (ageParts.length) {
    parts.push(`年龄 ${ageParts.join(" / ")}`);
  }
  if (desc) {
    parts.push(desc);
  }
  return parts.join(" · ");
}
export function openEventDetailModal(form, options = {}) {
  const { onBack = null } = options;
  const eventData = getLatestEvent(form);
  const registrationClosed = isFormRegistrationClosed(form);
  const startDT = eventData?.datetime ? new Date(eventData.datetime) : null;
  const endDT = eventData?.end_datetime ? new Date(eventData.end_datetime) : null;

  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: 0,
    zIndex: getMaxZIndex() + 1,
    background: "rgba(8, 14, 24, 0.56)",
    backdropFilter: "blur(8px)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "16px",
    boxSizing: "border-box",
  });

  const modal = document.createElement("div");
  Object.assign(modal.style, {
    width: "100%",
    maxWidth: "780px",
    maxHeight: "88vh",
    background: "linear-gradient(180deg, rgba(255,255,255,.96), rgba(248,250,252,.94))",
    borderRadius: "20px",
    overflow: "hidden",
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr) auto",
    boxShadow: "0 30px 80px rgba(0,0,0,.35)",
  });

  const header = document.createElement("div");
  Object.assign(header.style, {
    padding: "16px 18px",
    borderBottom: "1px solid rgba(15,23,42,.08)",
    display: "grid",
    gap: "4px",
  });

  const eyebrow = document.createElement("div");
  eyebrow.textContent = "活动详情";
  Object.assign(eyebrow.style, {
    fontSize: "12px",
    letterSpacing: ".16em",
    textTransform: "uppercase",
    color: "#6366f1",
    fontWeight: "900",
  });

  const title = document.createElement("div");
  title.textContent = eventData?.event_name || form?.title || "报名表";
  Object.assign(title.style, {
    fontSize: "22px",
    fontWeight: "900",
    color: "#0f172a",
    lineHeight: "1.25",
  });

  const subtitle = document.createElement("div");
  subtitle.textContent = "先确认活动资料、地点和说明，再继续进入流程与填写。";
  Object.assign(subtitle.style, {
    fontSize: "13px",
    lineHeight: "1.6",
    color: "#475569",
  });

  header.append(eyebrow, title, subtitle);

  const body = document.createElement("div");
  Object.assign(body.style, {
    padding: "16px",
    overflowY: "auto",
    display: "grid",
    gap: "14px",
  });

  const overview = createSection("活动资料", "这里展示当前表单关联的活动基本信息。");
  const overviewGrid = createFactGrid();
  overviewGrid.append(
    createFact("活动名称", eventData?.event_name || form?.title || "—"),
    createFact("活动时间", startDT || endDT ? `${fmtDateTime(startDT)}${endDT ? ` → ${fmtDateTime(endDT)}` : ""}` : "未设置"),
    createFact("地点", eventData?.location || "未设置"),
    createFact("对象", eventData?.target || "未设置"),
  );
  overview.appendChild(overviewGrid);

  if (eventData?.purpose) {
    overview.appendChild(createFact("活动说明", eventData.purpose));
  }
  body.appendChild(overview);

  const formSection = createSection("报名表说明", "这部分是报名表本身的介绍与截止信息。");
  const formGrid = createFactGrid();
  formGrid.append(
    createFact("报名表标题", form?.title || "未设置"),
    createFact("报名截止", form?.expired || "未设置"),
  );
  formSection.appendChild(formGrid);
  if (form?.detail) {
    formSection.appendChild(createFact("表格详情", form.detail));
  }
  body.appendChild(formSection);

  if (Array.isArray(form?.fees) && form.fees.length) {
    const feeSection = createSection("收费项目", "报名后如果有费用，会按这里的项目进入付款页面。");
    feeSection.appendChild(
      createBulletList(
        form.fees
          .slice()
          .sort((left, right) => Number(left?.amount || 0) - Number(right?.amount || 0))
          .map(buildFeeLine),
      ),
    );
    body.appendChild(feeSection);
  }

  if (eventData?.brochure_path) {
    const brochureHint = createSection("活动简章", "下一步后，如果活动绑定了简章文件，系统会先打开简章预览。");
    brochureHint.appendChild(createFact("简章文件", eventData.brochure_name || "已附带活动简章"));
    body.appendChild(brochureHint);
  }

  const footer = document.createElement("div");
  Object.assign(footer.style, {
    padding: "14px 16px",
    borderTop: "1px solid rgba(15,23,42,.08)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
    background: "rgba(255,255,255,.68)",
  });

  const left = document.createElement("div");
  Object.assign(left.style, {
    display: "flex",
    gap: "10px",
    alignItems: "center",
    flexWrap: "wrap",
  });

  const right = document.createElement("div");
  Object.assign(right.style, {
    display: "flex",
    gap: "10px",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  });

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.textContent = onBack ? "返回" : "关闭";
  applyGhostButtonStyle(backBtn);
  backBtn.onclick = () => {
    overlay.remove();
    if (typeof onBack === "function") {
      onBack();
    }
  };

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.textContent = "继续查看流程";
  applyPrimaryButtonStyle(nextBtn);
  nextBtn.onclick = () => {
    if (registrationClosed) {
      alert("报名已截止，无法继续报名");
      return;
    }

    overlay.remove();
    openFlowModal(form, {
      onBack: () => openEventDetailModal(form, options),
    });
  };

  const closedText = document.createElement("div");
  closedText.textContent = form?.expired
    ? `报名已截止（截止日期：${form.expired}）`
    : "报名已截止";
  Object.assign(closedText.style, {
    padding: "10px 12px",
    borderRadius: "12px",
    fontWeight: "900",
    fontSize: "14px",
    background: "rgba(239,68,68,.08)",
    border: "1px solid rgba(239,68,68,.22)",
    color: "rgb(185,28,28)",
  });

  left.appendChild(backBtn);
  right.appendChild(registrationClosed ? closedText : nextBtn);
  footer.append(left, right);

  modal.append(header, body, footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function applyPrimaryButtonStyle(button) {
  Object.assign(button.style, {
    border: "none",
    borderRadius: "12px",
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: "900",
    background: "linear-gradient(135deg, rgb(102,126,234), rgb(118,75,162))",
    color: "#fff",
  });
}

function applyGhostButtonStyle(button) {
  Object.assign(button.style, {
    border: "1px solid rgba(148,163,184,.28)",
    borderRadius: "12px",
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: "800",
    background: "#fff",
    color: "#334155",
  });
}
