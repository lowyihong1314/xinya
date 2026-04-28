import { useEffect, useMemo, useState } from "react";

import { openOverlay } from "../../app/OverlayProvider";
import { apiFetch } from "../../js/apiFetch";

export type ClaimPickerRecord = {
  id: number;
  applicant_name?: string;
  amount?: number | string;
  request_date?: string;
  department_name?: string;
  purpose?: string;
  event_name?: string;
  status?: string;
  created_at?: string;
};

type ClaimPickerResponse = {
  data?: ClaimPickerRecord[];
  message?: string;
  error?: string;
};

async function fetchClaims() {
  const response = await apiFetch("/api/account/get_all_claim", {
    credentials: "include",
  });
  const payload = (await response.json().catch(() => ({}))) as ClaimPickerResponse;
  if (!response.ok) {
    throw new Error(payload.error || payload.message || "获取报销申请失败");
  }
  return Array.isArray(payload.data) ? payload.data : [];
}

function ClaimPickerModal({
  title,
  onClose,
}: {
  title: string;
  onClose: (claim: ClaimPickerRecord | null) => void;
}) {
  const [claims, setClaims] = useState<ClaimPickerRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    void (async () => {
      setLoading(true);
      setError("");
      try {
        const payload = await fetchClaims();
        if (!active) {
          return;
        }
        setClaims(payload.sort((left, right) => right.id - left.id));
      } catch (nextError) {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : "获取报销申请失败");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const filteredClaims = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return claims;
    }
    return claims.filter((claim) =>
      [
        claim.id,
        claim.applicant_name,
        claim.department_name,
        claim.purpose,
        claim.event_name,
        claim.request_date,
        claim.status,
        claim.amount,
      ]
        .map((value) => String(value ?? "").toLowerCase())
        .some((value) => value.includes(keyword)),
    );
  }, [claims, query]);

  const selectedClaim =
    filteredClaims.find((claim) => claim.id === selectedId) ||
    claims.find((claim) => claim.id === selectedId) ||
    null;

  return (
    <div style={overlayStyle} onClick={() => onClose(null)}>
      <div style={modalStyle} onClick={(event) => event.stopPropagation()}>
        <div style={headerStyle}>
          <div>
            <div style={eyebrowStyle}>Claim Picker</div>
            <h3 style={titleStyle}>{title}</h3>
          </div>
          <button type="button" style={secondaryButtonStyle} onClick={() => onClose(null)}>
            关闭
          </button>
        </div>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索报销单号 / 申请人 / 部门 / 用途 / 状态"
          style={searchInputStyle}
        />

        <div style={infoRowStyle}>
          <div style={selectionInfoStyle}>
            {selectedClaim ? `已选择报销单 #${selectedClaim.id}` : "未选择报销单"}
          </div>
          <div style={resultInfoStyle}>{`显示 ${filteredClaims.length} / ${claims.length} 张报销单`}</div>
        </div>

        {loading ? <div style={stateStyle}>加载中…</div> : null}
        {!loading && error ? <div style={stateStyle}>{error}</div> : null}
        {!loading && !error && !filteredClaims.length ? <div style={stateStyle}>没有匹配的报销申请</div> : null}

        {!loading && !error && filteredClaims.length ? (
          <div style={listStyle}>
            {filteredClaims.map((claim) => {
              const selected = claim.id === selectedId;
              return (
                <button
                  key={claim.id}
                  type="button"
                  style={{
                    ...claimCardStyle,
                    ...(selected ? claimCardSelectedStyle : null),
                  }}
                  onClick={() => setSelectedId(claim.id)}
                >
                  <div style={claimCardTopRowStyle}>
                    <div style={claimTitleStyle}>{`报销单 #${claim.id}`}</div>
                    <div style={claimStatusStyle}>{claim.status || "-"}</div>
                  </div>
                  <div style={claimMetaStyle}>
                    {claim.applicant_name || "未填写申请人"}
                    {claim.request_date ? ` · ${claim.request_date}` : ""}
                    {claim.amount != null ? ` · RM ${claim.amount}` : ""}
                  </div>
                  <div style={claimMetaStyle}>
                    {claim.department_name || "未填写部门"}
                    {claim.event_name ? ` · ${claim.event_name}` : ""}
                  </div>
                  <div style={claimPurposeStyle}>{claim.purpose || "未填写用途"}</div>
                </button>
              );
            })}
          </div>
        ) : null}

        <div style={footerStyle}>
          <button type="button" style={secondaryButtonStyle} onClick={() => onClose(null)}>
            取消
          </button>
          <button
            type="button"
            style={primaryButtonStyle}
            disabled={!selectedClaim}
            onClick={() => onClose(selectedClaim)}
          >
            选择报销单
          </button>
        </div>
      </div>
    </div>
  );
}

export function showClaimPicker(options?: { title?: string }) {
  return new Promise<ClaimPickerRecord | null>((resolve) => {
    openOverlay((close) => (
      <ClaimPickerModal
        title={options?.title || "选择报销申请单号"}
        onClose={(claim) => {
          close();
          resolve(claim);
        }}
      />
    ));
  });
}

const overlayStyle = {
  position: "fixed" as const,
  inset: 0,
  zIndex: 10000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "20px",
  background: "rgba(15, 23, 42, 0.52)",
};

const modalStyle = {
  width: "min(920px, 100%)",
  maxHeight: "88vh",
  overflowY: "auto" as const,
  padding: "20px",
  borderRadius: "24px",
  background: "linear-gradient(180deg, #ffffff, #f6f8fb)",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  boxShadow: "0 24px 56px rgba(15, 23, 42, 0.24)",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "12px",
  marginBottom: "14px",
};

const eyebrowStyle = {
  marginBottom: "8px",
  fontSize: "11px",
  letterSpacing: "0.18em",
  textTransform: "uppercase" as const,
  color: "#64748b",
};

const titleStyle = {
  margin: 0,
  fontSize: "24px",
  fontWeight: 900,
  color: "#0f172a",
};

const searchInputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: "14px",
  border: "1px solid rgba(148, 163, 184, 0.3)",
  background: "#fff",
  boxSizing: "border-box" as const,
};

const infoRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  flexWrap: "wrap" as const,
  marginTop: "12px",
};

const selectionInfoStyle = {
  fontSize: "13px",
  color: "#475569",
  fontWeight: 700,
};

const resultInfoStyle = {
  fontSize: "13px",
  color: "#64748b",
};

const stateStyle = {
  padding: "32px 14px",
  textAlign: "center" as const,
  color: "#64748b",
};

const listStyle = {
  display: "grid",
  gap: "10px",
  marginTop: "16px",
};

const claimCardStyle = {
  display: "grid",
  gap: "6px",
  padding: "14px 16px",
  borderRadius: "16px",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  background: "#fff",
  textAlign: "left" as const,
  cursor: "pointer",
};

const claimCardSelectedStyle = {
  border: "1px solid rgba(14, 116, 144, 0.42)",
  background: "linear-gradient(180deg, rgba(240,249,255,0.96), rgba(236,253,245,0.96))",
  boxShadow: "0 14px 30px rgba(14, 116, 144, 0.12)",
};

const claimCardTopRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "10px",
  alignItems: "center",
};

const claimTitleStyle = {
  fontSize: "15px",
  fontWeight: 800,
  color: "#0f172a",
};

const claimStatusStyle = {
  fontSize: "12px",
  color: "#0f766e",
  fontWeight: 700,
};

const claimMetaStyle = {
  fontSize: "13px",
  color: "#475569",
  lineHeight: 1.55,
};

const claimPurposeStyle = {
  fontSize: "13px",
  color: "#334155",
  lineHeight: 1.6,
};

const footerStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  marginTop: "18px",
  flexWrap: "wrap" as const,
};

const secondaryButtonStyle = {
  padding: "10px 14px",
  borderRadius: "999px",
  border: "1px solid rgba(148, 163, 184, 0.3)",
  background: "#fff",
  color: "#0f172a",
  cursor: "pointer",
  fontWeight: 700,
};

const primaryButtonStyle = {
  padding: "10px 16px",
  borderRadius: "999px",
  border: "none",
  background: "linear-gradient(135deg, #0f766e, #0369a1)",
  color: "#fff",
  cursor: "pointer",
  fontWeight: 800,
};
