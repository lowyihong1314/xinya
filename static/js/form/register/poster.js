import { getMaxZIndex } from "../../get_Max_zindex.js";
import { openEventDetailModal } from "./event_detail.js";
import { checkImageOk, isFormRegistrationClosed } from "./utils.js";

export async function handleEntry(form) {
  const ogMeta = document.querySelector('meta[property="og:image"]');
  const bgUrl = ogMeta?.getAttribute("content");
  const ok = bgUrl ? await checkImageOk(bgUrl) : false;

  if (ok) {
    openPosterModal(bgUrl, form);
    return;
  }

  openEventDetailModal(form);
}

export function openPosterModal(posterUrl, form, options = {}) {
  const { onBack = null } = options;
  const registrationClosed = isFormRegistrationClosed(form);
  const modal = document.createElement("div");
  Object.assign(modal.style, {
    position: "fixed",
    inset: "0",
    zIndex: getMaxZIndex() + 1,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    pointerEvents: "none",
  });

  const card = document.createElement("div");
  Object.assign(card.style, {
    width: "100%",
    maxWidth: "720px",
    maxHeight: "85vh",
    borderRadius: "16px",
    overflow: "hidden",
    background: "#ffffffd0",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 30px 80px rgba(0,0,0,.35)",
    pointerEvents: "auto",
  });

  const header = document.createElement("div");
  Object.assign(header.style, {
    padding: "14px 16px",
    fontWeight: "900",
    borderBottom: "1px solid rgba(0,0,0,.08)",
  });
  header.textContent = "活动海报";

  const body = document.createElement("div");
  Object.assign(body.style, {
    padding: "16px",
    display: "flex",
    justifyContent: "center",
  });

  const img = document.createElement("img");
  img.src = posterUrl;
  img.alt = "poster";
  Object.assign(img.style, {
    width: "100%",
    maxHeight: "60vh",
    objectFit: "contain",
    borderRadius: "12px",
    boxShadow: "0 12px 26px rgba(0,0,0,.18)",
  });
  body.appendChild(img);

  const footer = document.createElement("div");
  Object.assign(footer.style, {
    padding: "14px 16px",
    borderTop: "1px solid rgba(0,0,0,.08)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "10px",
  });

  const left = document.createElement("div");
  Object.assign(left.style, {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  });

  const right = document.createElement("div");
  Object.assign(right.style, {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  });

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.textContent = "返回";
  Object.assign(backBtn.style, {
    border: "1px solid rgba(148,163,184,.28)",
    borderRadius: "12px",
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: "800",
    background: "#fff",
    color: "#334155",
  });
  backBtn.onclick = () => {
    modal.remove();
    if (typeof onBack === "function") {
      onBack();
    }
  };

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.textContent = "下载海报";
  Object.assign(downloadBtn.style, {
    border: "1px solid rgba(102,126,234,.35)",
    borderRadius: "12px",
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: "800",
    background: "rgba(255,255,255,.9)",
    color: "#3b4cca",
  });
  downloadBtn.onclick = () => {
    const a = document.createElement("a");
    a.href = posterUrl;
    a.download = "event_poster";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

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

    modal.remove();
    openEventDetailModal(form, {
      onBack: () => openPosterModal(posterUrl, form, options),
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
  right.append(downloadBtn);
  if (registrationClosed) {
    right.appendChild(closedText);
  } else {
    right.appendChild(nextBtn);
  }
  footer.append(left, right);
  card.append(header, body, footer);
  modal.appendChild(card);
  document.body.appendChild(modal);
}
