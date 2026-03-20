export function applyPageShell(container, bgUrl) {
  Object.assign(container.style, {
    position: "relative",
    minHeight: "100vh",
    width: "100%",
    overflow: "hidden",
    boxSizing: "border-box",
  });

  const bgLayer = document.createElement("div");
  Object.assign(bgLayer.style, {
    position: "absolute",
    inset: "0",
    zIndex: "0",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    filter: "blur(14px)",
    transform: "scale(1.08)",
  });
  if (bgUrl) {
    bgLayer.style.backgroundImage = `url("${bgUrl}")`;
  }

  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "absolute",
    inset: "0",
    zIndex: "1",
    background:
      "linear-gradient(180deg, rgba(248,250,252,.84), rgba(241,245,249,.92))",
  });

  const content = document.createElement("div");
  Object.assign(content.style, {
    position: "relative",
    zIndex: "2",
    width: "100%",
    maxWidth: "760px",
    margin: "0 auto",
    padding: "24px 16px 48px",
    boxSizing: "border-box",
  });

  container.append(bgLayer, overlay, content);
  return content;
}

export function createCard() {
  const card = document.createElement("section");
  Object.assign(card.style, {
    display: "grid",
    gap: "18px",
    padding: "24px",
    borderRadius: "24px",
    background: "rgba(255,255,255,.88)",
    border: "1px solid rgba(148,163,184,.2)",
    boxShadow: "0 26px 70px rgba(15,23,42,.14)",
    backdropFilter: "blur(10px)",
  });
  return card;
}

export function createField(labelText, inputEl) {
  const wrap = document.createElement("label");
  Object.assign(wrap.style, {
    display: "grid",
    gap: "8px",
  });

  const label = document.createElement("span");
  label.textContent = labelText;
  Object.assign(label.style, {
    fontSize: "13px",
    fontWeight: "800",
    color: "#334155",
  });

  Object.assign(inputEl.style, {
    width: "100%",
    boxSizing: "border-box",
    padding: "12px 14px",
    borderRadius: "14px",
    border: "1px solid rgba(148,163,184,.32)",
    background: "rgba(255,255,255,.95)",
    fontSize: "15px",
    color: "#0f172a",
    outline: "none",
  });

  wrap.append(label, inputEl);
  return wrap;
}

export function createButton(text) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  Object.assign(button.style, {
    border: "none",
    borderRadius: "999px",
    padding: "12px 18px",
    fontWeight: "800",
    cursor: "pointer",
    background: "linear-gradient(135deg, #0f766e, #155e75)",
    color: "#fff",
  });
  return button;
}
