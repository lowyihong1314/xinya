import type { CSSProperties } from "react";
import { showCCTVModal } from "./showCCTVModal";

export function CCTVPage() {
  const hlsUrl = "/cctv_rdsp_converd/cam1/live.m3u8";

  return (
    <div style={pageStyle}>
      <section style={heroStyle}>
        <div style={eyebrowStyle}>CCTV</div>
        <h2 style={titleStyle}>监控中心</h2>
        <p style={copyStyle}>
          统一复用 CRM 下的 CCTV 模块。这里可以直接打开直播和 PTZ 控制，不再保留 profile 私有实现。
        </p>
        <div style={actionsStyle}>
          <button type="button" style={openButtonStyle} onClick={() => showCCTVModal(hlsUrl)}>
            打开监控
          </button>
          <div style={hintStyle}>{`当前默认流: ${hlsUrl}`}</div>
        </div>
      </section>
    </div>
  );
}

const pageStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
};

const heroStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
  padding: "20px",
  borderRadius: "18px",
  background: "linear-gradient(160deg, #12343b, #0f766e)",
  color: "#fff",
  boxShadow: "0 20px 50px rgba(15,23,42,0.18)",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  opacity: "0.72",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "34px",
  lineHeight: 1.1,
};

const copyStyle: CSSProperties = {
  margin: 0,
  maxWidth: "68ch",
  lineHeight: 1.7,
  opacity: "0.88",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  gap: "12px",
  flexWrap: "wrap",
  alignItems: "center",
};

const openButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "none",
  background: "#fff",
  color: "#0f766e",
  fontWeight: 700,
  cursor: "pointer",
};

const hintStyle: CSSProperties = {
  fontSize: "13px",
  opacity: "0.72",
};
