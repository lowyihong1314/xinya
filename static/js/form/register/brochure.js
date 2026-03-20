import { getMaxZIndex } from "../../get_Max_zindex.js";
import { openNricModal } from "./nric.js";

function getExt(name = "", mime = "") {
  const normalizedName = String(name || "").toLowerCase();
  const normalizedMime = String(mime || "").toLowerCase();
  const ext = normalizedName.includes(".") ? normalizedName.split(".").pop() || "" : "";
  return ext || (normalizedMime.includes("/") ? normalizedMime.split("/").pop() || "" : "");
}

function isPdf(ext, mime = "") {
  return ext === "pdf" || String(mime || "").toLowerCase().includes("pdf");
}

function buildPublicFileUrl(filePath) {
  return new URL(`/media_file/${filePath}`, window.location.origin).toString();
}

function buildOfficeEmbedUrl(fileUrl) {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`;
}

export function hasBrochureFile(eventData) {
  return Boolean(String(eventData?.brochure_path || "").trim());
}

export function openBrochurePreviewModal(form, eventData, options = {}) {
  const { onBack = null } = options;
  const brochurePath = String(eventData?.brochure_path || "").trim();
  if (!brochurePath) {
    openNricModal(form, options);
    return;
  }

  const brochureName = eventData?.brochure_name || "简章";
  const brochureMime = eventData?.brochure_mime || "";
  const ext = getExt(brochureName, brochureMime);
  const fileUrl = buildPublicFileUrl(brochurePath);
  const previewUrl = isPdf(ext, brochureMime) ? fileUrl : buildOfficeEmbedUrl(fileUrl);

  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: 0,
    zIndex: getMaxZIndex() + 2,
    background: "rgba(8, 14, 24, 0.72)",
    backdropFilter: "blur(10px)",
    padding: "12px",
    boxSizing: "border-box",
    display: "grid",
  });

  const shell = document.createElement("div");
  Object.assign(shell.style, {
    width: "100%",
    height: "100%",
    background: "linear-gradient(180deg, #ffffff, #f8fafc)",
    borderRadius: "18px",
    overflow: "hidden",
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    boxShadow: "0 24px 60px rgba(0,0,0,.28)",
  });

  const header = document.createElement("div");
  Object.assign(header.style, {
    padding: "14px 16px",
    borderBottom: "1px solid rgba(0,0,0,.08)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
  });

  const copy = document.createElement("div");
  Object.assign(copy.style, {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minWidth: "0",
  });

  const badge = document.createElement("div");
  badge.textContent = isPdf(ext, brochureMime) ? "PDF" : "Office Online";
  Object.assign(badge.style, {
    fontSize: "12px",
    letterSpacing: ".14em",
    textTransform: "uppercase",
    color: "rgb(79,70,229)",
    fontWeight: "800",
  });

  const title = document.createElement("div");
  title.textContent = brochureName;
  Object.assign(title.style, {
    fontWeight: "900",
    fontSize: "16px",
    color: "#0f172a",
    wordBreak: "break-word",
  });

  copy.append(badge, title);

  const actions = document.createElement("div");
  Object.assign(actions.style, {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
  });

  const openBtn = document.createElement("a");
  openBtn.href = fileUrl;
  openBtn.target = "_blank";
  openBtn.rel = "noreferrer";
  openBtn.textContent = "新窗口打开";
  applyGhostButtonStyle(openBtn);

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.textContent = "返回";
  applyGhostButtonStyle(backBtn);
  backBtn.onclick = () => {
    overlay.remove();
    if (typeof onBack === "function") {
      onBack();
    }
  };

  const continueBtn = document.createElement("button");
  continueBtn.type = "button";
  continueBtn.textContent = "继续报名";
  applyPrimaryButtonStyle(continueBtn);
  continueBtn.onclick = () => {
    overlay.remove();
    openNricModal(form, {
      onBack: () => openBrochurePreviewModal(form, eventData, options),
    });
  };

  actions.append(backBtn, openBtn, continueBtn);
  header.append(copy, actions);

  const frameWrap = document.createElement("div");
  Object.assign(frameWrap.style, {
    minHeight: "0",
    height: "100%",
    background: "#f1f5f9",
  });

  const frame = document.createElement("iframe");
  frame.src = previewUrl;
  frame.title = brochureName;
  Object.assign(frame.style, {
    width: "100%",
    height: "100%",
    minHeight: "calc(100vh - 150px)",
    border: "none",
    display: "block",
    background: "#fff",
  });

  frameWrap.appendChild(frame);
  shell.append(header, frameWrap);
  overlay.appendChild(shell);
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
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
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
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  });
}
