import { getMaxZIndex } from "../../get_Max_zindex.js";
import { renderSignPreviewSvg, render_sign_modal } from "../../sign_tools.js";
import { buildAgreementSection, buildBrief, buildHeader } from "./content.js";
import { exportModalToPdf } from "./print.js";
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
  signLab.dataset.pdfRemove = "true";
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
  status.dataset.pdfRemove = "true";
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

function applyParentData(parent, nextParent) {
  if (!nextParent || typeof nextParent !== "object") {
    return false;
  }

  [
    "parent_cn",
    "parent_en",
    "parent_nric",
    "parent_phone",
    "child_cn",
    "child_en",
    "child_nric",
    "child_phone",
    "sign",
    "sign_date",
    "sign_json_data",
  ].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(nextParent, key)) {
      parent[key] = nextParent[key];
    }
  });

  return true;
}

function updateAgreementFields(fields, parent) {
  fields.p_cn.value = parent.parent_cn || "";
  fields.p_en.value = parent.parent_en || "";
  fields.p_nric.value = parent.parent_nric || "";
  fields.p_phone.value = parent.parent_phone || "";
  fields.child_cn.value = parent.child_cn || "";
  fields.child_en.value = parent.child_en || "";
  fields.child_nric.value = parent.child_nric || "";
  fields.c_phone.value = parent.child_phone || "";
  if (fields.sign) {
    fields.sign.value = parent.sign || "";
  }
  if (fields.date) {
    fields.date.value = parent.sign_date || "";
  }
}

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
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

function getFormPdfFilename(lastEvent, payload) {
  return (
    lastEvent?.title ||
    lastEvent?.event_name ||
    lastEvent?.name ||
    payload?.form_title ||
    payload?.form_name ||
    "parental_consent"
  );
}

function buildShareFormContext(form) {
  if (!form || typeof form !== "object") {
    return form;
  }

  return {
    id: form.id,
    title: form.title,
    event_name: form.event_name,
    name: form.name,
    events: Array.isArray(form.events)
      ? form.events.map((event) => ({
          id: event.id,
          event_name: event.event_name,
          datetime: event.datetime,
          end_datetime: event.end_datetime,
          location: event.location,
          type: event.type,
          target: event.target,
          purpose: event.purpose,
        }))
      : undefined,
  };
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
  onParentSync,
  readOnly,
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
          form: buildShareFormContext(lastEvent),
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
  okBtn.textContent = readOnly ? "下载 PDF" : "我同意，继续";
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

    if (!readOnly && !parent.parent_cn && !parent.parent_en) {
      alert("请填写家长姓名（中/英至少一个）");
      return;
    }
    if (!readOnly && !parent.parent_nric) {
      alert("请填写家长 NRIC");
      return;
    }
    if (!readOnly && !parent.parent_phone) {
      alert("请填写家长联络电话");
      return;
    }
    if (!readOnly && (!parent.sign_json_data || !parent.sign_json_data.strokes?.length)) {
      alert("请完成签名");
      return;
    }
    if (!readOnly && parent.sign_json_data?.strokes?.length && !parent.sign_date) {
      parent.sign_date = todayISODate();
    }

    if (shareOnly) {
      onParentSync?.();
      await new Promise((done) => window.setTimeout(done, 80));
    }

    if (!shareOnly) {
      await exportModalToPdf(modal, {
        filename: getFormPdfFilename(lastEvent, payload),
      });
      if (readOnly) {
        return;
      }
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
  const onParentDataSync =
    typeof options.onParentDataSync === "function"
      ? options.onParentDataSync
      : null;

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
        sync();
        safeParent.sign_json_data = nextSign;
        if (!safeParent.sign_date) {
          safeParent.sign_date = todayISODate();
        }
        roomConnection?.emitParentData(safeParent);
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
        onParentSync() {
          sync();
          roomConnection?.emitParentData(safeParent);
        },
        readOnly,
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
        const remoteParent = message?.parent;
        const remoteSign = message?.sign_json_data || remoteParent?.sign_json_data;
        const hasParentData = applyParentData(safeParent, remoteParent);

        if (!hasParentData && !remoteSign) {
          return;
        }

        if (hasParentData) {
          updateAgreementFields(fields, safeParent);
        }
        if (remoteSign) {
          safeParent.sign_json_data = remoteSign;
          if (!safeParent.sign_date) {
            safeParent.sign_date = todayISODate();
          }
          signArea.updateRemoteSign(remoteSign);
        } else {
          signArea.setStatus("已收到远程资料更新");
        }
        shareDialog?.setWaitingText("已收到家长资料和签名，孩子这边可以继续提交了。");
        if (onParentDataSync) {
          signArea.setStatus("已收到远程资料，正在保存到 CRM...");
          Promise.resolve(onParentDataSync({ ...safeParent }))
            .then(() => {
              signArea.setStatus("已保存家长签名资料");
              shareDialog?.setWaitingText("已收到家长资料和签名，并已保存到 CRM。");
            })
            .catch((error) => {
              console.error("[parental-sign-sync] save failed", error);
              signArea.setStatus("已收到远程资料，但保存到 CRM 失败");
              shareDialog?.setWaitingText("已收到家长资料和签名，但保存到 CRM 失败，请稍后重试。");
            });
        }
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
