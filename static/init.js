const API_BASE = "/api/api";
const app = document.getElementById("app");

function getArgs() {
  return new URLSearchParams(window.location.search);
}

function clearApp() {
  app.innerHTML = "";
}

function createCard(title, onClick) {
  const card = document.createElement("div");
  card.className = "card";
  card.textContent = title;
  card.onclick = onClick;
  return card;
}

/* =========================
   ROUTER INIT
========================= */
export function init() {
  const args = getArgs();
  const group = args.get("group_type");

  clearApp();

  if (!group) return;

  if (group === "all") {
    renderGroupList();
  } else {
    render_group_detail(group);
  }
}

/* =========================
   GROUP LIST VIEW
========================= */
async function renderGroupList() {
  const res = await fetch(`${API_BASE}/get_file_list?group_type=all`);
  const data = await res.json();

  const groups = new Set();

  (data.files || []).forEach((f) => groups.add(f.group));

  groups.forEach((group) => {
    app.appendChild(
      createCard(`📁 ${group}`, () => render_group_detail(group)),
    );
  });

  // ===== Add new group card =====
  app.appendChild(
    createCard("➕ Add New Group", () => {
      // ===== Overlay =====
      const overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      });

      // ===== Popup =====
      const popup = document.createElement("div");
      Object.assign(popup.style, {
        background: "white",
        padding: "20px",
        borderRadius: "12px",
        width: "320px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      });

      const title = document.createElement("div");
      title.textContent = "Create New Group";
      Object.assign(title.style, {
        fontWeight: "600",
        fontSize: "16px",
      });

      // ===== Input =====
      const input = document.createElement("input");
      input.placeholder = "Group name";
      Object.assign(input.style, {
        padding: "10px",
        fontSize: "14px",
        borderRadius: "8px",
        border: "1px solid #ccc",
      });

      // 🚫 Filter invalid characters
      input.addEventListener("input", () => {
        const clean = input.value.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");

        if (input.value !== clean) {
          input.value = clean;
        }
      });

      // ===== Buttons =====
      const btnRow = document.createElement("div");
      Object.assign(btnRow.style, {
        display: "flex",
        gap: "10px",
      });

      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Cancel";
      Object.assign(cancelBtn.style, {
        flex: 1,
        background: "#aaa",
      });

      const okBtn = document.createElement("button");
      okBtn.textContent = "Create";
      Object.assign(okBtn.style, {
        flex: 1,
        background: "#1976d2",
        color: "white",
      });

      const closePopup = () => overlay.remove();

      cancelBtn.onclick = closePopup;

      okBtn.onclick = () => {
        const name = input.value.trim();
        if (!name) return;

        closePopup();

        const url = `https://utbabuddha.com/static/upload_files.html?group_type=${encodeURIComponent(name)}`;

        // ===== Share overlay =====
        const shareOverlay = document.createElement("div");
        Object.assign(shareOverlay.style, {
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.35)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10000,
        });

        const sharePopup = document.createElement("div");
        Object.assign(sharePopup.style, {
          background: "white",
          padding: "20px",
          borderRadius: "12px",
          width: "420px",
          maxWidth: "90%",
          boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        });

        const shareTitle = document.createElement("div");
        shareTitle.textContent = "Group Link";
        Object.assign(shareTitle.style, {
          fontWeight: "600",
          fontSize: "16px",
        });

        const urlBox = document.createElement("input");
        urlBox.value = url;
        urlBox.readOnly = true;
        Object.assign(urlBox.style, {
          padding: "10px",
          fontSize: "13px",
          borderRadius: "8px",
          border: "1px solid #ccc",
        });

        const btnRow = document.createElement("div");
        Object.assign(btnRow.style, {
          display: "flex",
          gap: "10px",
        });

        const closeBtn = document.createElement("button");
        closeBtn.textContent = "Close";
        Object.assign(closeBtn.style, {
          flex: 1,
          background: "#aaa",
        });

        const copyBtn = document.createElement("button");
        copyBtn.textContent = "Copy";
        Object.assign(copyBtn.style, {
          flex: 1,
          background: "#1976d2",
          color: "white",
        });
        const openBtn = document.createElement("button");
        openBtn.textContent = "Open";
        Object.assign(openBtn.style, {
          flex: 1,
          background: "#4caf50",
          color: "white",
        });

        openBtn.onclick = () => {
          window.open(url, "_blank"); // 新标签打开
        };

        const closeShare = () => shareOverlay.remove();

        closeBtn.onclick = closeShare;

        copyBtn.onclick = async () => {
          try {
            await navigator.clipboard.writeText(url);
            copyBtn.textContent = "Copied!";
            setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
          } catch {
            urlBox.select();
            document.execCommand("copy");
          }
        };

        shareOverlay.addEventListener("click", (e) => {
          if (e.target === shareOverlay) closeShare();
        });

        btnRow.appendChild(closeBtn);
        btnRow.appendChild(openBtn);
        btnRow.appendChild(copyBtn);

        sharePopup.appendChild(shareTitle);
        sharePopup.appendChild(urlBox);
        sharePopup.appendChild(btnRow);

        shareOverlay.appendChild(sharePopup);
        document.body.appendChild(shareOverlay);

        urlBox.select();
      };

      // ===== Keyboard support =====
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") okBtn.click();
        if (e.key === "Escape") closePopup();
      });

      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(okBtn);

      popup.appendChild(title);
      popup.appendChild(input);
      popup.appendChild(btnRow);

      overlay.appendChild(popup);
      document.body.appendChild(overlay);

      input.focus();
    }),
  );
}

/* =========================
   GROUP DETAIL VIEW
========================= */
export async function render_group_detail(group) {
  clearApp();

  const header = document.createElement("h2");
  header.textContent = `📁 ${group}`;
  app.appendChild(header);

  // ===== Upload button card (opens popup) =====
  const uploadCard = document.createElement("div");
  uploadCard.className = "card";
  uploadCard.style.cursor = "default";

  const uploadBtn = document.createElement("button");
  uploadBtn.textContent = "Upload";
  uploadBtn.onclick = () => {
    // ===== Overlay =====
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.35)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999,
    });

    // ===== Popup =====
    const popup = document.createElement("div");
    Object.assign(popup.style, {
      background: "white",
      padding: "20px",
      borderRadius: "12px",
      width: "360px",
      boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
    });

    const title = document.createElement("div");
    title.textContent = `Upload to: ${group}`;
    Object.assign(title.style, {
      fontWeight: "600",
      fontSize: "16px",
    });

    // ===== File input =====
    const fileInput = document.createElement("input");
    fileInput.type = "file";

    // ===== file_name input =====
    const nameInput = document.createElement("input");
    nameInput.placeholder = "File name (required)";
    Object.assign(nameInput.style, {
      padding: "10px",
      fontSize: "14px",
      borderRadius: "8px",
      border: "1px solid #ccc",
    });

    // ✅ allow 中文 + 英文 + 数字 only (no spaces, no punctuation, no -/_)
    nameInput.addEventListener("input", () => {
      const clean = nameInput.value.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
      if (nameInput.value !== clean) nameInput.value = clean;
    });

    // auto fill file_name from selected file (optional)
    fileInput.addEventListener("change", () => {
      if (!fileInput.files?.length) return;
      const f = fileInput.files[0];
      const base = (f.name || "").split(".").slice(0, -1).join(".") || f.name;
      // 只做一次填充，避免用户改了又被覆盖
      if (!nameInput.value.trim()) {
        nameInput.value = (base || "").replace(
          /[^\u4e00-\u9fa5a-zA-Z0-9]/g,
          "",
        );
      }
    });

    const err = document.createElement("div");
    Object.assign(err.style, {
      color: "#d32f2f",
      fontSize: "12px",
      display: "none",
    });

    const btnRow = document.createElement("div");
    Object.assign(btnRow.style, {
      display: "flex",
      gap: "10px",
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    Object.assign(cancelBtn.style, {
      flex: 1,
      background: "#aaa",
    });

    const okBtn = document.createElement("button");
    okBtn.textContent = "Upload";
    Object.assign(okBtn.style, {
      flex: 1,
      background: "#1976d2",
      color: "white",
    });

    const closePopup = () => overlay.remove();

    cancelBtn.onclick = closePopup;

    okBtn.onclick = async () => {
      err.style.display = "none";

      if (!fileInput.files?.length) {
        err.textContent = "Please select a file.";
        err.style.display = "block";
        return;
      }

      const fileName = nameInput.value.trim();
      if (!fileName) {
        err.textContent = "File name is required.";
        err.style.display = "block";
        return;
      }

      const fd = new FormData();
      fd.append("file", fileInput.files[0]);
      fd.append("group_name", group);
      fd.append("file_name", fileName);

      okBtn.disabled = true;
      okBtn.textContent = "Uploading...";

      try {
        const res = await fetch(`${API_BASE}/uploadfile`, {
          method: "POST",
          body: fd,
        });

        const json = await res.json().catch(() => ({}));

        if (!res.ok) {
          err.textContent = json?.error || "Upload failed.";
          err.style.display = "block";
          okBtn.disabled = false;
          okBtn.textContent = "Upload";
          return;
        }

        // ✅ success → close + auto refresh
        closePopup();
        render_group_detail(group);
      } catch (e) {
        err.textContent = "Network error.";
        err.style.display = "block";
        okBtn.disabled = false;
        okBtn.textContent = "Upload";
      }
    };

    // keyboard
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") okBtn.click();
      if (e.key === "Escape") closePopup();
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closePopup(); // click outside to close
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(okBtn);

    popup.appendChild(title);
    popup.appendChild(fileInput);
    popup.appendChild(nameInput);
    popup.appendChild(err);
    popup.appendChild(btnRow);

    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    nameInput.focus();
  };

  uploadCard.appendChild(uploadBtn);
  app.appendChild(uploadCard);

  // ===== Refresh button =====
  const refresh = document.createElement("button");
  refresh.textContent = "Refresh";
  refresh.onclick = () => location.reload(true);
  app.appendChild(refresh);

  // ===== File list =====
  const res = await fetch(
    `${API_BASE}/get_file_list?group_type=${encodeURIComponent(group)}`,
  );
  const data = await res.json();

  if (!data.files || data.files.length === 0) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.style.cursor = "default";
    empty.textContent = "No files.";
    app.appendChild(empty);
    return;
  }

  (data.files || []).forEach((file) => {
    const item = document.createElement("div");
    item.className = "card file-item";
    item.style.cursor = "default";

    const name = document.createElement("div");
    name.textContent = `${file.name}.${file.ext} (${formatSize(file.size)})`;

    const btn = document.createElement("button");
    btn.textContent = "Download";
    btn.onclick = () => {
      window.location.href = `${API_BASE}/download_file/${encodeURIComponent(file.filename)}`;
    };

    item.appendChild(name);
    item.appendChild(btn);
    app.appendChild(item);
  });
}

/* =========================
   Utils
========================= */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

init();
