import { getMaxZIndex } from "../../get_Max_zindex.js";
import { hasBrochureFile, openBrochurePreviewModal } from "./brochure.js";
import { openNricModal } from "./nric.js";
import {
  addMinutes,
  fmtClock,
  fmtDateTime,
  isFormRegistrationClosed,
} from "./utils.js";
import {
  available_time_slot_json,
  setAvailableTimeSlotJson,
  setLastEvent,
} from "./state.js";

export function openFlowModal(form, options = {}) {
  const { onBack = null } = options;
  const registrationClosed = isFormRegistrationClosed(form);
  const nextEvent =
    Array.isArray(form.events) && form.events.length
      ? form.events[form.events.length - 1]
      : null;
  setLastEvent(nextEvent);

  const flows =
    nextEvent && Array.isArray(nextEvent.event_flows)
      ? nextEvent.event_flows
      : [];

  const startDT = nextEvent?.datetime ? new Date(nextEvent.datetime) : null;
  const endDT = nextEvent?.end_datetime ? new Date(nextEvent.end_datetime) : null;
  let cumulative = 0;

  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: 0,
    zIndex: getMaxZIndex() + 1,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "16px",
    boxSizing: "border-box",
  });

  const modal = document.createElement("div");
  Object.assign(modal.style, {
    width: "100%",
    maxWidth: "720px",
    maxHeight: "85vh",
    background: "#ffffffd0",
    borderRadius: "16px",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  });

  const header = document.createElement("div");
  Object.assign(header.style, {
    padding: "14px 16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: "1px solid rgba(0,0,0,.08)",
    fontWeight: "900",
  });

  const hTitle = document.createElement("div");
  hTitle.textContent = nextEvent?.event_name
    ? `活动流程：${nextEvent.event_name}`
    : "活动流程";
  header.append(hTitle);

  const body = document.createElement("div");
  Object.assign(body.style, {
    padding: "16px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  });

  const hint = document.createElement("div");
  Object.assign(hint.style, {
    padding: "10px 12px",
    borderRadius: "12px",
    background: "rgba(102,126,234,.08)",
    border: "1px solid rgba(102,126,234,.18)",
    fontSize: "13px",
  });
  if (registrationClosed) {
    Object.assign(hint.style, {
      background: "rgba(239,68,68,.08)",
      border: "1px solid rgba(239,68,68,.22)",
      color: "rgb(185,28,28)",
      fontWeight: "800",
    });
    hint.textContent = form?.expired
      ? `报名已截止，截止日期：${form.expired}`
      : "报名已截止";
  } else {
    hint.textContent = flows.length
      ? "这是活动流程，确认没问题就按「下一步」。"
      : "这个活动还没有设置流程，你可以直接按「下一步」。";
  }
  body.appendChild(hint);

  const slotItems = [];
  const sorted = flows.length
    ? [...flows].sort((a, b) => (Number(a.no) || 0) - (Number(b.no) || 0))
    : [];

  sorted.forEach((f, idx) => {
    const row = document.createElement("div");
    Object.assign(row.style, {
      padding: "12px 12px",
      borderRadius: "12px",
      border: "1px solid rgba(0,0,0,.08)",
      display: "grid",
      gridTemplateColumns: "32px 1fr",
      gap: "10px",
      alignItems: "start",
    });

    const mins = Number(f.minutes);
    let rowStart = null;
    let rowEnd = null;
    if (startDT && Number.isFinite(mins) && mins > 0) {
      rowStart = addMinutes(startDT, cumulative);
      rowEnd = addMinutes(rowStart, mins);
    }
    if (Number.isFinite(mins) && mins > 0) {
      cumulative += mins;
    }

    const tick = document.createElement("input");
    tick.type = "checkbox";
    tick.checked = true;
    tick.disabled = registrationClosed;
    Object.assign(tick.style, {
      width: "18px",
      height: "18px",
      marginTop: "2px",
      cursor: registrationClosed ? "default" : "pointer",
      accentColor: "rgb(102,126,234)",
    });

    const slotItem = {
      checked: true,
      startISO: rowStart ? rowStart.toISOString() : null,
      endISO: rowEnd ? rowEnd.toISOString() : null,
    };
    slotItems.push(slotItem);

    tick.addEventListener("change", () => {
      slotItem.checked = tick.checked;
      row.style.opacity = tick.checked ? "1" : "0.55";
    });

    const content = document.createElement("div");
    Object.assign(content.style, {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
    });

    const r1 = document.createElement("div");
    r1.textContent = `${idx + 1}. ${f.title || "(无标题)"}`;
    Object.assign(r1.style, { fontWeight: "900" });

    const r2 = document.createElement("div");
    r2.textContent = f.detail || "";
    Object.assign(r2.style, { fontSize: "13px", opacity: 0.9 });

    const r3 = document.createElement("div");
    if (rowStart && rowEnd) {
      r3.textContent = `${fmtClock(rowStart)} → ${fmtClock(rowEnd)}（${mins}m）`;
    } else if (Number.isFinite(mins) && mins > 0) {
      r3.textContent = `时长 ${mins}m`;
    } else {
      r3.textContent = "";
    }
    Object.assign(r3.style, { fontSize: "12px", opacity: 0.75 });

    content.appendChild(r1);
    if (f.detail) {
      content.appendChild(r2);
    }
    if (r3.textContent) {
      content.appendChild(r3);
    }

    row.append(tick, content);
    body.appendChild(row);
  });

  const footer = document.createElement("div");
  Object.assign(footer.style, {
    padding: "14px 16px",
    borderTop: "1px solid rgba(0,0,0,.08)",
    display: "flex",
    gap: "10px",
    justifyContent: "space-between",
    alignItems: "center",
  });

  const dateInfo = document.createElement("div");
  Object.assign(dateInfo.style, {
    fontSize: "12px",
    opacity: 0.8,
    lineHeight: "1.4",
  });
  dateInfo.textContent =
    startDT || endDT
      ? `开始：${fmtDateTime(startDT)}  ｜  结束：${fmtDateTime(endDT)}`
      : "未设置活动开始/结束时间";

  const actionWrap = document.createElement("div");
  Object.assign(actionWrap.style, {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
  });

  // const backBtn = document.createElement("button");
  // backBtn.type = "button";
  // backBtn.textContent = "返回";
  // Object.assign(backBtn.style, {
  //   border: "1px solid rgba(148,163,184,.28)",
  //   borderRadius: "12px",
  //   padding: "10px 14px",
  //   cursor: "pointer",
  //   fontWeight: "800",
  //   background: "#fff",
  //   color: "#334155",
  // });
  // backBtn.onclick = () => {
  //   overlay.remove();
  //   if (typeof onBack === "function") {
  //     onBack();
  //   }
  // };

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.textContent = "下一步";
  Object.assign(nextBtn.style, {
    border: "none",
    borderRadius: "12px",
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: "900",
    background: "linear-gradient(135deg, rgb(102,126,234), rgb(118,75,162))",
    color: "#fff",
  });
  nextBtn.onclick = () => {
    if (isFormRegistrationClosed(form)) {
      alert("报名已截止，无法继续报名");
      return;
    }

    setAvailableTimeSlotJson(
      slotItems
        .filter((x) => x.checked && x.startISO && x.endISO)
        .map((x) => ({
          datetime: x.startISO,
          end_datetime: x.endISO,
        })),
    );

    console.log("available_time_slot_json =", available_time_slot_json);
    overlay.remove();
    if (hasBrochureFile(nextEvent)) {
      openBrochurePreviewModal(form, nextEvent, {
        onBack: () => openFlowModal(form, options),
      });
      return;
    }
    openNricModal(form, {
      onBack: () => openFlowModal(form, options),
    });
  };

  const closedText = document.createElement("div");
  closedText.textContent = "报名已截止";
  Object.assign(closedText.style, {
    padding: "10px 12px",
    borderRadius: "12px",
    fontWeight: "900",
    fontSize: "14px",
    background: "rgba(239,68,68,.08)",
    border: "1px solid rgba(239,68,68,.22)",
    color: "rgb(185,28,28)",
  });

  actionWrap.append(registrationClosed ? closedText : nextBtn);
  footer.append(dateInfo, actionWrap);
  modal.append(header, body, footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
