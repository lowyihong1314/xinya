import { getMaxZIndex } from "../../get_Max_zindex.js";
import { renderSignPreviewSvg, render_sign_modal } from "../../sign_tools.js";
import { buildAgreementSection, buildBrief, buildHeader } from "./content.js";
import { exportModalToPdf, freezeModalToPrintable } from "./print.js";
import {
  buildParentalRoomId,
  connectParentalSignRoom,
  createShortParentalShareUrl,
} from "./socket.js";

function createOverlay() {
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: 0,
    zIndex: getMaxZIndex() + 1,
    background: "rgba(0,0,0,.55)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "14px",
    boxSizing: "border-box",
  });
  return overlay;
}

function createModalShell() {
  const modal = document.createElement("div");
  Object.assign(modal.style, {
    width: "100%",
    maxWidth: "900px",
    height: "92vh",
    background: "rgba(255,255,255,.92)",
    borderRadius: "16px",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  });
  return modal;
}

function createBody() {
  const body = document.createElement("div");
  Object.assign(body.style, {
    padding: "16px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  });
  return body;
}

function createFooter() {
  const footer = document.createElement("div");
  Object.assign(footer.style, {
    padding: "14px 16px",
    borderTop: "1px solid rgba(0,0,0,.08)",
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    alignItems: "center",
    background: "rgba(255,255,255,.7)",
  });
  return footer;
}

function createSignPreview(parent, readOnly, options = {}) {
  const signWrap = document.createElement("div");
  Object.assign(signWrap.style, {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  });

  const signLab = document.createElement("div");
  signLab.textContent = "签名（点击签名）";
  Object.assign(signLab.style, {
    fontWeight: "900",
    fontSize: "12px",
    opacity: 0.8,
  });

  const signPreview = document.createElement("div");
  Object.assign(signPreview.style, {
    width: "100%",
    height: "110px",
    borderRadius: "12px",
    border: "1px solid rgba(0,0,0,.15)",
    background: "rgba(255,255,255,.9)",
    cursor: "pointer",
  });

  renderSignPreviewSvg(signPreview, parent.sign_json_data);

  const status = document.createElement("div");
  status.textContent = options.syncRoom ? "已启用远程签名同步" : "";
  Object.assign(status.style, {
    minHeight: "16px",
    fontSize: "11px",
    color: "#64748b",
  });

  if (readOnly) {
    signPreview.style.pointerEvents = "none";
    signPreview.style.opacity = "0.6";
  } else {
    signPreview.addEventListener("click", async () => {
      const signJsonData = await render_sign_modal(parent.sign_json_data, {
        onChange: (nextSign) => {
          parent.sign_json_data = nextSign;
          renderSignPreviewSvg(signPreview, parent.sign_json_data);
          options.onSignChange?.(nextSign);
        },
      });
      if (!signJsonData) {
        return;
      }

      parent.sign_json_data = signJsonData;
      renderSignPreviewSvg(signPreview, parent.sign_json_data);
      options.onSignChange?.(signJsonData);
    });
  }

  signWrap.append(signLab, signPreview, status);
  return {
    signWrap,
    updateRemoteSign(nextSign) {
      parent.sign_json_data = nextSign;
      renderSignPreviewSvg(signPreview, parent.sign_json_data);
      status.textContent = "已收到远程签名更新";
    },
    setStatus(text) {
      status.textContent = text || "";
    },
  };
}

function applyReadOnly(fields) {
  [
    fields.p_cn,
    fields.p_en,
    fields.p_nric,
    fields.p_phone,
    fields.child_cn,
    fields.child_en,
    fields.child_nric,
    fields.c_phone,
  ].forEach((el) => {
    el.disabled = true;
    el.style.background = "rgba(0,0,0,.05)";
    el.style.cursor = "not-allowed";
  });
}

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
  return Promise.resolve();
}

function createQrImage(url) {
  const img = document.createElement("img");
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;
  img.alt = "家长签名二维码";
  Object.assign(img.style, {
    width: "220px",
    height: "220px",
    borderRadius: "16px",
    background: "#fff",
    border: "1px solid rgba(148,163,184,0.24)",
    boxShadow: "0 16px 36px rgba(15,23,42,0.08)",
  });
  return img;
}

function openShareDialog(url) {
  const shareOverlay = document.createElement("div");
  Object.assign(shareOverlay.style, {
    position: "fixed",
    inset: 0,
    zIndex: getMaxZIndex() + 2,
    background: "rgba(15,23,42,0.36)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    boxSizing: "border-box",
  });

  const card = document.createElement("div");
  Object.assign(card.style, {
    width: "min(460px, 100%)",
    padding: "24px",
    borderRadius: "24px",
    background: "linear-gradient(180deg, rgba(255,255,255,.98), rgba(244,247,255,.98))",
    border: "1px solid rgba(99,102,241,0.14)",
    boxShadow: "0 28px 60px rgba(15,23,42,0.16)",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    alignItems: "center",
    textAlign: "center",
  });

  const eyebrow = document.createElement("div");
  eyebrow.textContent = "Parental Sign";
  Object.assign(eyebrow.style, {
    fontSize: "11px",
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    color: "#6366f1",
    fontWeight: "800",
  });

  const title = document.createElement("h3");
  title.textContent = "发给家长签名";
  Object.assign(title.style, {
    margin: "0",
    fontSize: "28px",
    color: "#1e1b4b",
    lineHeight: "1.05",
  });

  const hint = document.createElement("p");
  hint.textContent = "让家长扫码或打开链接完成签名。请留在此页等待，签名会自动同步回来。";
  Object.assign(hint.style, {
    margin: "0",
    color: "#475569",
    lineHeight: "1.7",
    fontSize: "14px",
  });

  const waiting = document.createElement("div");
  waiting.textContent = "等待家长签名中...";
  Object.assign(waiting.style, {
    width: "100%",
    padding: "12px 14px",
    borderRadius: "14px",
    background: "rgba(59,130,246,0.08)",
    border: "1px solid rgba(59,130,246,0.16)",
    color: "#1d4ed8",
    fontWeight: "700",
    fontSize: "14px",
    boxSizing: "border-box",
  });

  const linkBox = document.createElement("div");
  linkBox.textContent = url;
  Object.assign(linkBox.style, {
    width: "100%",
    maxHeight: "88px",
    overflowY: "auto",
    padding: "12px 14px",
    borderRadius: "14px",
    border: "1px solid rgba(148,163,184,0.24)",
    background: "#fff",
    color: "#334155",
    fontSize: "12px",
    lineHeight: "1.6",
    wordBreak: "break-all",
    boxSizing: "border-box",
    textAlign: "left",
  });

  const actions = document.createElement("div");
  Object.assign(actions.style, {
    display: "flex",
    gap: "10px",
    width: "100%",
    justifyContent: "center",
    flexWrap: "wrap",
  });

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.textContent = "复制链接";
  Object.assign(copyBtn.style, {
    border: "none",
    borderRadius: "999px",
    padding: "12px 18px",
    cursor: "pointer",
    fontWeight: "800",
    background: "linear-gradient(135deg, #2563eb, #4f46e5)",
    color: "#fff",
  });
  copyBtn.onclick = async () => {
    await copyText(url);
    waiting.textContent = "链接已复制，等待家长签名中...";
  };

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "关闭";
  Object.assign(closeBtn.style, {
    border: "1px solid rgba(148,163,184,0.28)",
    borderRadius: "999px",
    padding: "12px 18px",
    cursor: "pointer",
    fontWeight: "700",
    background: "#fff",
    color: "#0f172a",
  });
  closeBtn.onclick = () => shareOverlay.remove();

  actions.append(copyBtn, closeBtn);
  card.append(
    eyebrow,
    title,
    hint,
    createQrImage(url),
    waiting,
    linkBox,
    actions,
  );
  shareOverlay.appendChild(card);
  document.body.appendChild(shareOverlay);

  shareOverlay.addEventListener("click", (event) => {
    if (event.target === shareOverlay) {
      shareOverlay.remove();
    }
  });
  card.addEventListener("click", (event) => event.stopPropagation());

  return {
    close() {
      shareOverlay.remove();
    },
    setWaitingText(text) {
      waiting.textContent = text;
    },
  };
}

function createActionButtons({
  lastEvent,
  payload,
  parent,
  sync,
  modal,
  overlay,
  resolve,
  can_close,
  shareOnly,
  syncRoom,
  onShareReady,
}) {
  const actions = document.createElement("div");
  Object.assign(actions.style, {
    display: "flex",
    gap: "10px",
    marginLeft: "auto",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  });

  if (!shareOnly && syncRoom && lastEvent?.id && payload?.nric) {
    const shareBtn = document.createElement("button");
    shareBtn.type = "button";
    shareBtn.textContent = "发给家长签名";
    Object.assign(shareBtn.style, {
      border: "1px solid rgba(59,130,246,.25)",
      borderRadius: "12px",
      padding: "10px 14px",
      cursor: "pointer",
      background: "#fff",
      color: "#1d4ed8",
      fontWeight: "800",
    });
    shareBtn.onclick = async () => {
      sync();
      try {
        const shareUrl = await createShortParentalShareUrl({
          form: lastEvent,
          payload,
          parent,
          room: syncRoom,
        });
        onShareReady?.(openShareDialog(shareUrl));
      } catch (error) {
        console.error(error);
        alert(error instanceof Error ? error.message : "创建家长签名链接失败");
      }
    };
    actions.appendChild(shareBtn);
  }

  if (can_close) {
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "关闭";
    Object.assign(closeBtn.style, {
      border: "1px solid rgba(0,0,0,.2)",
      borderRadius: "12px",
      padding: "10px 14px",
      cursor: "pointer",
      background: "#eee",
      fontWeight: "700",
    });
    closeBtn.onclick = () => {
      overlay.remove();
      resolve(parent);
    };
    actions.appendChild(closeBtn);
  }

  const okBtn = document.createElement("button");
  okBtn.type = "button";
  okBtn.textContent = "我同意，继续";
  Object.assign(okBtn.style, {
    border: "none",
    borderRadius: "12px",
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: "900",
    background: "linear-gradient(135deg, rgb(102,126,234), rgb(118,75,162))",
    color: "#fff",
    flexShrink: "0",
  });

  okBtn.onclick = async () => {
    sync();

    if (!parent.parent_cn && !parent.parent_en) {
      alert("请填写家长姓名（中/英至少一个）");
      return;
    }
    if (!parent.parent_nric) {
      alert("请填写家长 NRIC");
      return;
    }
    if (!parent.parent_phone) {
      alert("请填写家长联络电话");
      return;
    }
    if (!parent.sign_json_data || !parent.sign_json_data.strokes?.length) {
      alert("请完成签名");
      return;
    }

    if (!shareOnly) {
      freezeModalToPrintable(modal);
      await exportModalToPdf(modal);
    }

    overlay.remove();
    resolve(parent);
  };

  actions.appendChild(okBtn);
  return actions;
}

export function openParentalFormModal(
  lastEvent,
  payload,
  parent,
  readOnly,
  can_close,
  options = {},
) {
  console.log("打开家长同意书弹窗，预填 payload =", lastEvent, payload, parent);
  const safeParent = parent && typeof parent === "object" ? parent : {};
  const syncRoom = options.syncRoom || buildParentalRoomId(lastEvent, payload);
  const shareOnly = Boolean(options.shareOnly);

  return new Promise((resolve) => {
    const overlay = createOverlay();
    const modal = createModalShell();
    const body = createBody();
    const footer = createFooter();
    let roomConnection = null;
    let shareDialog = null;

    const { agreeBox, fields, sync } = buildAgreementSection({
      lastEvent,
      payload,
      parent: safeParent,
    });

    body.append(buildBrief(lastEvent), agreeBox);

    if (readOnly) {
      applyReadOnly(fields);
    }

    const signArea = createSignPreview(safeParent, readOnly, {
      syncRoom,
      onSignChange(nextSign) {
        roomConnection?.emitSign(nextSign);
      },
    });

    footer.append(
      signArea.signWrap,
      createActionButtons({
        lastEvent,
        payload,
        parent: safeParent,
        sync,
        modal,
        overlay,
        resolve,
        can_close,
        shareOnly,
        syncRoom,
        onShareReady(dialog) {
          shareDialog = dialog;
        },
      }),
    );

    if (can_close) {
      overlay.addEventListener("click", () => {
        overlay.remove();
        resolve(safeParent);
      });
      modal.addEventListener("click", (e) => e.stopPropagation());
    }

    modal.append(buildHeader(lastEvent), body, footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    if (syncRoom) {
      connectParentalSignRoom(syncRoom, (message) => {
        if (!message?.sign_json_data) {
          return;
        }
        signArea.updateRemoteSign(message.sign_json_data);
        shareDialog?.setWaitingText("已收到家长签名，孩子这边可以继续提交了。");
      })
        .then((connection) => {
          roomConnection = connection;
          signArea.setStatus("已连接远程签名通道");
        })
        .catch((error) => {
          console.warn("[parental-sign-sync] connect failed", error);
          signArea.setStatus("远程签名通道连接失败");
        });
    }

    const cleanup = () => {
      roomConnection?.disconnect();
      roomConnection = null;
      shareDialog?.close();
      shareDialog = null;
    };

    const originalResolve = resolve;
    resolve = (value) => {
      cleanup();
      originalResolve(value);
    };

    sync();
  });
}

export const open_parental_form = openParentalFormModal;
