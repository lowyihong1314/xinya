import { useState } from "react";
import type { CSSProperties } from "react";
import QRCode from "qrcode";

// 左上角 logo，点击弹出当前页 URL 的二维码。用于所有公开入口页。
export function LogoQrBadge({ logoSrc = "/static/images/logo/logo.png" }: { logoSrc?: string }) {
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState("");
  const [qrUrl, setQrUrl] = useState("");

  function show() {
    // 二维码只编码基础地址，不带任何 query args（如 nric / form_id / token）
    const url = window.location.origin + window.location.pathname;
    setQrUrl(url);
    setOpen(true);
    setQr("");
    void QRCode.toDataURL(url, { width: 360, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(""));
  }

  return (
    <>
      <button type="button" style={badgeStyle} onClick={show} title="显示二维码" aria-label="显示二维码">
        <img src={logoSrc} alt="logo" style={imgStyle} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
      </button>
      {open ? (
        <div style={overlayStyle} onClick={() => setOpen(false)}>
          <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={titleStyle}>扫码打开此页</div>
            {qr ? <img src={qr} alt="二维码" style={qrImgStyle} /> : <div style={{ padding: 60, color: "#64748b" }}>生成中…</div>}
            <div style={urlStyle}>{qrUrl}</div>
            <button type="button" style={closeStyle} onClick={() => setOpen(false)}>关闭</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

const badgeStyle: CSSProperties = { position: "fixed", top: 10, left: 10, zIndex: 900, width: 44, height: 44, border: "none", background: "transparent", boxShadow: "none", cursor: "pointer", padding: 0, display: "grid", placeItems: "center" };
const imgStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "contain", display: "block" };
const overlayStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 2000, background: "rgba(15,23,42,0.6)", display: "grid", placeItems: "center", padding: 20 };
const cardStyle: CSSProperties = { width: "min(340px, 100%)", background: "#fff", borderRadius: 18, padding: 20, textAlign: "center", boxShadow: "0 30px 70px rgba(0,0,0,0.4)", display: "grid", gap: 12, justifyItems: "center", color: "#1f2937" };
const titleStyle: CSSProperties = { fontSize: 16, fontWeight: 800 };
const qrImgStyle: CSSProperties = { width: "min(280px, 78vw)", height: "auto", borderRadius: 12, border: "1px solid #e5e7eb" };
const urlStyle: CSSProperties = { fontSize: 11.5, color: "#64748b", wordBreak: "break-all", fontFamily: "ui-monospace, monospace" };
const closeStyle: CSSProperties = { padding: "9px 20px", borderRadius: 10, border: "none", background: "#6366f1", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" };
