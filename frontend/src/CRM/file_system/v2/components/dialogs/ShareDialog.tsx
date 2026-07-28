import { useState } from "react";

import { copyTextToClipboard } from "../../../../../js/browserActions";
import { useFsActions } from "../../context";
import { dialogInputStyle, dialogLabelStyle, primaryButtonStyle, softButtonStyle } from "../../styles";
import type { SelectableItem } from "../../types";
import { DialogShell } from "./DialogShell";

export function ShareDialog({ item }: { item: SelectableItem }) {
  const actions = useFsActions();
  const [minutes, setMinutes] = useState("30");
  const [credit, setCredit] = useState("1");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    const url = await actions.submitShare(item, Math.max(1, Number(minutes) || 30), Math.max(1, Number(credit) || 1));
    setSubmitting(false);
    if (url) setShareUrl(url);
  }

  async function copy() {
    if (!shareUrl) return;
    await copyTextToClipboard(shareUrl);
    setCopied(true);
  }

  if (shareUrl) {
    return (
      <DialogShell title="分享链接已生成" onClose={actions.closeDialog} hideFooter>
        <label style={dialogLabelStyle}>
          任何人凭此链接可在有效期内下载「{item.name}」
          <input style={dialogInputStyle} value={shareUrl} readOnly onFocus={(event) => event.target.select()} />
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" style={softButtonStyle} onClick={actions.closeDialog}>
            关闭
          </button>
          <button type="button" style={primaryButtonStyle} onClick={() => void copy()}>
            <i className={copied ? "fa-solid fa-check" : "fa-solid fa-copy"} /> {copied ? "已复制" : "复制链接"}
          </button>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell
      title={`分享「${item.name}」`}
      onClose={actions.closeDialog}
      onConfirm={() => void submit()}
      confirmText={submitting ? "生成中…" : "生成链接"}
      confirmDisabled={submitting}
    >
      <div style={{ display: "flex", gap: 12 }}>
        <label style={{ ...dialogLabelStyle, flex: 1 }}>
          有效时长（分钟）
          <input
            style={dialogInputStyle}
            type="number"
            min={1}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </label>
        <label style={{ ...dialogLabelStyle, flex: 1 }}>
          可下载次数
          <input
            style={dialogInputStyle}
            type="number"
            min={1}
            value={credit}
            onChange={(event) => setCredit(event.target.value)}
          />
        </label>
      </div>
    </DialogShell>
  );
}
