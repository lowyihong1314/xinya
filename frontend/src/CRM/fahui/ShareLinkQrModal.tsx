import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import QRCode from "qrcode";

import { copyTextToClipboard } from "../../js/browserActions";
import { show_alert } from "../../js/show_alert";
import { Z_MODAL_TOP } from "./zLayers";

// 公开链接的 QR 弹窗：订单摘要抽屉和订单详情页共用。
//
// 点「公开链接」的场景基本是当面把单子给功德主看 —— 复制到剪贴板对隔着一张桌子
// 的人没用，让他扫码才是最快的。所以点完照旧自动复制（微信/WhatsApp 发得出去），
// 同时把码摆出来，底下再把 URL 原文列出来，扫不了的可以照着念或长按选取。

export type ShareLinkInfo = { url: string; days: number };

export function ShareLinkQrModal({ info, onClose }: { info: ShareLinkInfo; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(info.url, { width: 640, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } })
      .then((value) => {
        if (!cancelled) setDataUrl(value);
      })
      .catch(() => {
        // 码画不出来也别把弹窗弄没了，底下那行 URL 照样能用
        if (!cancelled) setError("二维码生成失败，请直接用下面的链接");
      });
    return () => {
      cancelled = true;
    };
  }, [info.url]);

  // 手机上多半是递给对方看，别让屏幕在中途暗下去
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const copyAgain = async () => {
    try {
      await copyTextToClipboard(info.url);
      show_alert("success", "链接已复制");
    } catch {
      show_alert("error", "复制失败，请长按下面的链接手动复制");
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <p style={styles.title}>公开链接</p>
        <p style={styles.hint}>{`已复制到剪贴板 · ${info.days} 天内有效`}</p>

        <div style={styles.qrBox}>
          {dataUrl ? (
            <img src={dataUrl} alt="公开链接二维码" style={styles.qrImg} />
          ) : (
            <p style={styles.qrState}>{error || "生成中…"}</p>
          )}
        </div>

        {/* URL 原文：扫不了码的可以长按选取，也方便当场核对是不是这一张单 */}
        <p style={styles.url}>{info.url}</p>

        <div style={styles.actions}>
          <button type="button" style={styles.secondary} onClick={() => void copyAgain()}>
            再复制一次
          </button>
          <button type="button" style={styles.primary} onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: Z_MODAL_TOP,
    display: "grid",
    placeItems: "center",
    padding: "20px",
    background: "rgba(15,23,42,0.55)",
  },
  panel: {
    width: "min(340px, 100%)",
    display: "grid",
    gap: "10px",
    padding: "18px",
    borderRadius: "16px",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line)",
    boxShadow: "0 24px 60px var(--x-color-shadow)",
    boxSizing: "border-box",
  },
  title: { margin: 0, fontSize: "15px", fontWeight: 800, color: "var(--x-color-ink)" },
  hint: { margin: 0, fontSize: "12.5px", color: "var(--x-color-ink-muted)" },
  qrBox: {
    display: "grid",
    placeItems: "center",
    padding: "10px",
    borderRadius: "12px",
    // 二维码要有白底才扫得稳，不能跟着深色主题走
    background: "#ffffff",
  },
  qrImg: { width: "100%", maxWidth: "260px", display: "block" },
  qrState: { margin: 0, padding: "40px 0", fontSize: "13px", color: "#64748b", textAlign: "center" },
  url: {
    margin: 0,
    padding: "8px 10px",
    borderRadius: "8px",
    background: "var(--x-color-panel-alt)",
    border: "1px solid var(--x-color-line)",
    fontSize: "12px",
    lineHeight: 1.5,
    color: "var(--x-color-ink)",
    // 链接很长，让它按字符断行，别把弹窗撑宽
    wordBreak: "break-all",
    // 长按可选取
    userSelect: "all",
  },
  actions: { display: "flex", gap: "8px", justifyContent: "flex-end" },
  secondary: {
    padding: "7px 14px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
  },
  primary: {
    padding: "7px 16px",
    borderRadius: "8px",
    border: "none",
    background: "var(--x-color-accent)",
    color: "#fff",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
  },
};
