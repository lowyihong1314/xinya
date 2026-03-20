import { getMaxZIndex } from "./get_Max_zindex.js";

export function renderSignPreviewSvg(wrapEl, sign_json_data) {
  // wrapEl 是一个 div（或任何容器）
  wrapEl.innerHTML = "";

  // 外观（你可以放到创建 wrap 时做，这里也补一层保障）
  Object.assign(wrapEl.style, {
    borderRadius: "12px",
    border: "1px solid rgba(0,0,0,.15)",
    background: "rgba(255,255,255,.9)",
    height: "110px",
    width: "100%",
    overflow: "hidden",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  });

  // 没签名：显示提示
  if (
    !sign_json_data ||
    !Array.isArray(sign_json_data.strokes) ||
    sign_json_data.strokes.length === 0
  ) {
    const tip = document.createElement("div");
    tip.textContent = "点击这里签名";
    Object.assign(tip.style, {
      fontSize: "14px",
      color: "rgba(0,0,0,.35)",
      fontWeight: "700",
    });
    wrapEl.appendChild(tip);
    return;
  }

  // 建一个 SVG（用 viewBox 0..1000，画起来更顺）
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 1000 300");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("preserveAspectRatio", "none");

  // 每条 stroke 转成一个 path
  for (const stroke of sign_json_data.strokes) {
    if (!stroke.points || stroke.points.length < 2) continue;

    // points 是 0..1，转成 viewBox 坐标
    const pts = stroke.points.map((p) => ({
      x: Math.max(0, Math.min(1, p.x)) * 1000,
      y: Math.max(0, Math.min(1, p.y)) * 300,
    }));

    // 简单线段 path：M x y L x y ...
    let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
    }

    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "rgba(0,0,0,.85)");
    path.setAttribute("stroke-width", "6"); // 你可以调粗细
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");

    svg.appendChild(path);
  }

  wrapEl.appendChild(svg);
}

export function render_sign_modal(existingSignJson, options = {}) {
  return new Promise((resolve) => {
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

    const modal = document.createElement("div");
    Object.assign(modal.style, {
      width: "100%",
      maxWidth: "760px",
      background: "rgba(255,255,255,.92)",
      borderRadius: "16px",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      boxShadow: "0 30px 90px rgba(0,0,0,.35)",
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
      padding: "14px 16px",
      borderBottom: "1px solid rgba(0,0,0,.08)",
      fontWeight: "900",
    });
    header.textContent = "请在下方签名";

    const body = document.createElement("div");
    Object.assign(body.style, { padding: "16px" });

    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 320;
    Object.assign(canvas.style, {
      width: "100%",
      height: "320px",
      borderRadius: "14px",
      border: "1px solid rgba(0,0,0,.15)",
      background: "#fff",
      touchAction: "none", // ⭐ 关键：手机/触控不滚动页面
      display: "block",
    });

    body.appendChild(canvas);

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

    const leftBtns = document.createElement("div");
    Object.assign(leftBtns.style, { display: "flex", gap: "10px" });

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.textContent = "清除";
    Object.assign(clearBtn.style, {
      border: "1px solid rgba(0,0,0,.15)",
      borderRadius: "12px",
      padding: "10px 14px",
      cursor: "pointer",
      fontWeight: "900",
      background: "rgba(255,255,255,.9)",
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "取消";
    Object.assign(cancelBtn.style, {
      border: "1px solid rgba(0,0,0,.15)",
      borderRadius: "12px",
      padding: "10px 14px",
      cursor: "pointer",
      fontWeight: "900",
      background: "rgba(255,255,255,.9)",
    });

    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.textContent = "完成签名";
    Object.assign(okBtn.style, {
      border: "none",
      borderRadius: "12px",
      padding: "10px 14px",
      cursor: "pointer",
      fontWeight: "900",
      background: "linear-gradient(135deg, rgb(102,126,234), rgb(118,75,162))",
      color: "#fff",
    });

    leftBtns.append(clearBtn, cancelBtn);
    footer.append(leftBtns, okBtn);

    modal.append(header, body, footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const ctx = canvas.getContext("2d");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0,0,0,.85)";
    ctx.lineWidth = 2.8;

    // ===== data structure =====
    // strokes: [{ points: [{x:0..1, y:0..1, t:ms}], ... }]
    const sign =
      existingSignJson && typeof existingSignJson === "object"
        ? JSON.parse(JSON.stringify(existingSignJson))
        : { strokes: [] };

    let syncTimer = null;
    const emitChange = () => {
      if (typeof options.onChange !== "function") return;
      if (syncTimer) {
        window.clearTimeout(syncTimer);
      }
      syncTimer = window.setTimeout(() => {
        options.onChange(JSON.parse(JSON.stringify(sign)));
      }, 40);
    };

    const applyExternalSign = (nextSign) => {
      sign.strokes = Array.isArray(nextSign?.strokes)
        ? JSON.parse(JSON.stringify(nextSign.strokes))
        : [];
      redraw();
    };

    const cleanupExternal =
      typeof options.onMount === "function" ? options.onMount(applyExternalSign) : null;

    // 载入已有签名
    renderSignPreview(canvas, sign);

    let drawing = false;
    let currentStroke = null;

    const getXY = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      return {
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
      };
    };

    const redraw = () => renderSignPreview(canvas, sign);

    canvas.addEventListener("pointerdown", (e) => {
      drawing = true;
      canvas.setPointerCapture(e.pointerId);
      const p = getXY(e);
      currentStroke = { points: [{ ...p, t: Date.now() }] };
      sign.strokes.push(currentStroke);
      redraw();
      emitChange();
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!drawing || !currentStroke) return;
      const p = getXY(e);
      currentStroke.points.push({ ...p, t: Date.now() });
      redraw();
      emitChange();
    });

    const endDraw = () => {
      drawing = false;
      currentStroke = null;
    };

    canvas.addEventListener("pointerup", endDraw);
    canvas.addEventListener("pointercancel", endDraw);

    clearBtn.onclick = () => {
      sign.strokes = [];
      redraw();
      emitChange();
    };

    cancelBtn.onclick = () => {
      if (syncTimer) window.clearTimeout(syncTimer);
      if (typeof cleanupExternal === "function") cleanupExternal();
      overlay.remove();
      resolve(null);
    };

    okBtn.onclick = () => {
      // 必须有笔画
      const has = sign.strokes.some((s) => s.points && s.points.length >= 2);
      if (!has) return alert("请先签名");
      if (syncTimer) window.clearTimeout(syncTimer);
      if (typeof cleanupExternal === "function") cleanupExternal();
      overlay.remove();
      resolve(sign);
    };

    // 点外面 = 取消
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        if (syncTimer) window.clearTimeout(syncTimer);
        if (typeof cleanupExternal === "function") cleanupExternal();
        overlay.remove();
        resolve(null);
      }
    });
  });
}

function renderSignPreview(canvas, sign_json_data) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 提示文字
  if (
    !sign_json_data ||
    !sign_json_data.strokes ||
    !sign_json_data.strokes.length
  ) {
    ctx.font = "14px sans-serif";
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillText("点击这里签名", 12, 24);
    return;
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,.85)";
  ctx.lineWidth = 2.5;

  for (const stroke of sign_json_data.strokes) {
    if (!stroke.points || stroke.points.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(
      stroke.points[0].x * canvas.width,
      stroke.points[0].y * canvas.height,
    );
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(
        stroke.points[i].x * canvas.width,
        stroke.points[i].y * canvas.height,
      );
    }
    ctx.stroke();
  }
}
