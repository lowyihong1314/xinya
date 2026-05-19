import { getMaxZIndex } from "../../get_Max_zindex.js";
import Swal from "https://cdn.jsdelivr.net/npm/sweetalert2@11/+esm";

export function freezeModalToPrintable(modalEl) {
  const inputs = modalEl.querySelectorAll("input, textarea, select");

  inputs.forEach((el) => {
    if (el.tagName === "INPUT" && el.type === "hidden") {
      el.remove();
      return;
    }

    const value =
      el.tagName === "SELECT"
        ? el.options?.[el.selectedIndex]?.textContent || ""
        : (el.value || "").trim();

    const div = document.createElement("div");
    div.textContent = value || "—";

    const st = getComputedStyle(el);
    Object.assign(div.style, {
      display: "inline-block",
      minHeight: st.height,
      padding: st.padding,
      borderRadius: st.borderRadius,
      border: st.border,
      background: "transparent",
      fontSize: st.fontSize,
      lineHeight: st.lineHeight,
      color: "rgba(0,0,0,.9)",
      verticalAlign: "middle",
      boxSizing: "border-box",
      whiteSpace: "pre-wrap",
    });

    el.replaceWith(div);
  });

  modalEl.style.background = "#fff";
}

function normalizePdfFilename(filename) {
  const rawName = String(filename || "parental_consent").trim();
  const withoutPdf = rawName.replace(/\.pdf$/i, "");
  const safeName = withoutPdf
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 140);

  return `${safeName || "parental_consent"}.pdf`;
}

export function showPdfPreview(blobUrl, filename = "parental_consent.pdf") {
  return new Promise((resolve) => {
    const downloadFilename = normalizePdfFilename(filename);
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,.55)",
      zIndex: getMaxZIndex() + 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "16px",
    });

    const box = document.createElement("div");
    Object.assign(box.style, {
      width: "100%",
      maxWidth: "900px",
      height: "90%",
      background: "#fff",
      borderRadius: "14px",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      boxShadow: "0 30px 90px rgba(0,0,0,.4)",
    });

    const header = document.createElement("div");
    header.textContent = "PDF 预览";
    Object.assign(header.style, {
      padding: "12px 16px",
      fontWeight: "900",
      borderBottom: "1px solid rgba(0,0,0,.1)",
      background: "#f7f7f7",
    });

    const iframe = document.createElement("iframe");
    iframe.src = blobUrl;
    Object.assign(iframe.style, {
      flex: 1,
      border: "none",
      width: "100%",
    });

    const footer = document.createElement("div");
    Object.assign(footer.style, {
      padding: "12px 16px",
      borderTop: "1px solid rgba(0,0,0,.1)",
      display: "flex",
      justifyContent: "flex-end",
      gap: "10px",
      background: "#f7f7f7",
    });

    const downloadBtn = document.createElement("button");
    downloadBtn.textContent = "下载 PDF";
    Object.assign(downloadBtn.style, {
      padding: "10px 16px",
      borderRadius: "10px",
      border: "none",
      cursor: "pointer",
      fontWeight: "700",
      background: "linear-gradient(135deg, rgb(102,126,234), rgb(118,75,162))",
      color: "#fff",
    });
    downloadBtn.onclick = () => {
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = downloadFilename;
      a.click();
    };

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "关闭";
    Object.assign(closeBtn.style, {
      padding: "10px 16px",
      borderRadius: "10px",
      border: "1px solid rgba(0,0,0,.15)",
      cursor: "pointer",
      fontWeight: "700",
      background: "#fff",
    });
    closeBtn.onclick = () => {
      URL.revokeObjectURL(blobUrl);
      overlay.remove();
      resolve();
    };

    footer.append(downloadBtn, closeBtn);
    box.append(header, iframe, footer);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

export async function exportModalToPdf(modalEl, options = {}) {
  const downloadFilename = normalizePdfFilename(options.filename);

  Swal.fire({
    title: "正在生成 PDF",
    text: "请稍候…",
    allowOutsideClick: false,
    allowEscapeKey: false,
    didOpen: () => {
      Swal.showLoading();

      const z = getMaxZIndex() + 1;
      const container = document.querySelector(".swal2-container");
      if (container) {
        container.style.zIndex = z;
      }
    },
  });

  try {
    const clone = modalEl.cloneNode(true);
    freezeModalToPrintable(clone);
    clone.querySelectorAll("[data-pdf-remove='true']").forEach((el) => el.remove());
    clone.querySelectorAll("button").forEach((b) => b.remove());

    clone.querySelectorAll("canvas").forEach((c) => {
      const img = document.createElement("img");
      img.src = c.toDataURL("image/png");
      img.style.width = c.style.width || "100%";
      img.style.height = c.style.height || "auto";
      c.replaceWith(img);
    });

    const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Parental Consent</title>
  <style>
    @font-face {
      font-family: "XinyaPdfCJK";
      src: url("/static/font/NotoSansCJKsc-Regular.otf") format("opentype");
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: "XinyaPdfCJK";
      src: url("/static/font/NotoSansCJKsc-Regular.otf") format("opentype");
      font-weight: 700;
      font-style: normal;
    }
    @font-face {
      font-family: "XinyaPdfCJK";
      src: url("/static/font/NotoSansCJKsc-Regular.otf") format("opentype");
      font-weight: 900;
      font-style: normal;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: "XinyaPdfCJK", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Sans CJK TC", Arial, sans-serif;
      background: #fff;
    }
    @page {
      size: A4;
      margin: 12mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    [style*="position: fixed"] {
      position: static !important;
    }
  </style>
</head>
<body>
  ${clone.outerHTML}
</body>
</html>
    `.trim();

    const formData = new FormData();
    formData.append("filename", downloadFilename);
    formData.append(
      "files",
      new Blob([html], { type: "text/html" }),
      "page.html",
    );

    const res = await fetch("/api/form/html_to_pdf", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      throw new Error("PDF 生成失败");
    }

    const pdfBlob = await res.blob();
    const url = URL.createObjectURL(pdfBlob);

    Swal.close();
    await showPdfPreview(url, downloadFilename);
  } catch (err) {
    Swal.close();
    console.error(err);
    Swal.fire({
      icon: "error",
      title: "生成失败",
      text: err.message || "请稍后再试",
    });
    throw err;
  }
}
