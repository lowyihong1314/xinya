import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

import { get_phone_on_localhost } from "../../js/get_phone_on_localhost";
import { useEnsureDesignTokens } from "../../theme/designTokens";
import { fetchLampByIds, postLampPayment } from "./api";

type LampPayment = {
  amount?: number | string;
  payer_name?: string;
  method?: string;
  paid_at?: string;
};

type LampOrder = {
  id?: number;
  devotee_name?: string;
  total_amount?: number | string;
  lamps?: Array<unknown>;
  payments?: LampPayment[];
};

type LampPaymentPageProps = {
  selected: LampOrder[];
  onBack: () => void;
  onCompleted?: () => Promise<void> | void;
};

export function LampPaymentPage({
  selected,
  onBack,
  onCompleted,
}: LampPaymentPageProps) {
  useEnsureDesignTokens();

  const [orders, setOrders] = useState<LampOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [payerName, setPayerName] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<"scan" | "transfer" | "cash">("scan");
  const [file, setFile] = useState<File | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const orderIds = useMemo(
    () => selected.map((row) => row.id).filter(Boolean) as number[],
    [selected],
  );

  useEffect(() => {
    void loadOrders();
  }, [orderIds.join(",")]);

  useEffect(() => {
    void loadPhone();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (method !== "scan" || !qrCanvasRef.current) return;
    void QRCode.toCanvas(
      qrCanvasRef.current,
      "00020201021126520014A000000615000101068900530220MDN163112377136573055204539953034585802MY5925PERTUBUHANPENGANUTAGAMABU6008ULUTIRAM630494FE",
      { width: 180, margin: 1 },
    ).catch(() => {
      setToast({ type: "error", text: "二维码生成失败" });
    });
  }, [method]);

  const allPayments = useMemo(
    () =>
      orders.flatMap((order) =>
        (order.payments || []).filter((payment) => Boolean(payment.paid_at)),
      ),
    [orders],
  );

  const totalOrderAmount = useMemo(
    () => orders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0),
    [orders],
  );

  const totalPaidAmount = useMemo(
    () => allPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    [allPayments],
  );

  const remaining = Number((totalOrderAmount - totalPaidAmount).toFixed(2));
  const requiresProof = method !== "cash";

  async function loadPhone() {
    try {
      const currentPhone = await get_phone_on_localhost(undefined, { poster: "/static/poster/lamp.png" });
      setPhone((currentPhone || "").trim());
    } catch {
      setPhone("");
    }
  }

  async function loadOrders() {
    if (!orderIds.length) {
      setOrders([]);
      setLoading(false);
      setToast({ type: "error", text: "没有可支付的记录" });
      return;
    }

    setLoading(true);
    try {
      const payload = await fetchLampByIds(orderIds);
      setOrders(Array.isArray(payload.data) ? payload.data : []);
    } catch (error) {
      setToast({
        type: "error",
        text: error instanceof Error ? error.message : "无法获取订单数据",
      });
    } finally {
      setLoading(false);
    }
  }

  async function submitPayment() {
    if (remaining <= 0) {
      setToast({ type: "success", text: "当前订单已经完成支付" });
      return;
    }

    if (!payerName.trim()) {
      setToast({ type: "error", text: "请填写付款人姓名" });
      return;
    }

    if (requiresProof && !file) {
      setToast({ type: "error", text: "扫码或转账需上传付款凭证" });
      return;
    }

    const formData = new FormData();
    formData.append("registration_ids", orderIds.join(","));
    formData.append("amount", String(remaining));
    formData.append("method", method);
    formData.append("payer_name", payerName.trim());
    formData.append("phone", phone);
    if (file) {
      formData.append("file", file);
    }

    setSaving(true);
    try {
      await postLampPayment(formData);
      setToast({ type: "success", text: "付款记录已保存" });
      await loadOrders();
      await onCompleted?.();
    } catch (error) {
      setToast({
        type: "error",
        text: error instanceof Error ? error.message : "保存付款失败",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={pageStyle}>
      <div style={shellStyle}>
        <div style={headerStyle}>
          <button type="button" style={secondaryButtonStyle} onClick={onBack}>
            返回点灯列表
          </button>
          <div>
            <div style={eyebrowStyle}>Lamp Payment</div>
            <h2 style={titleStyle}>支付处理</h2>
          </div>
        </div>

        {toast ? (
          <div style={toast.type === "success" ? successBannerStyle : errorBannerStyle}>
            {toast.text}
          </div>
        ) : null}

        {loading ? <div style={placeholderStyle}>读取订单中…</div> : null}

        {!loading ? (
          <>
            <section style={cardStyle}>
              <div style={sectionTitleStyle}>订单列表</div>
              <div style={stackStyle}>
                {orders.map((order) => (
                  <div key={order.id} style={orderRowStyle}>
                    <div>
                      <div style={orderNameStyle}>{order.devotee_name || "-"}</div>
                      <div style={metaStyle}>{(order.lamps || []).length} 项供灯</div>
                    </div>
                    <div style={amountStyle}>RM {Number(order.total_amount || 0).toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </section>

            <section style={cardStyle}>
              <div style={sectionTitleStyle}>付款记录</div>
              {!allPayments.length ? (
                <div style={placeholderStyle}>暂无付款记录</div>
              ) : (
                <div style={stackStyle}>
                  {allPayments.map((payment, index) => (
                    <div key={`${payment.paid_at || "pending"}-${index}`} style={paymentRowStyle}>
                      <div>
                        <div style={orderNameStyle}>RM {Number(payment.amount || 0).toFixed(2)}</div>
                        <div style={metaStyle}>
                          {payment.payer_name || "-"} · {payment.method || "-"}
                        </div>
                      </div>
                      <div style={metaStyle}>{payment.paid_at || "未确认"}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section style={cardStyle}>
              <div style={sectionTitleStyle}>提交付款</div>
              <div style={summaryCardStyle}>
                <div style={summaryRowStyle}>
                  <span>订单总额</span>
                  <strong>RM {totalOrderAmount.toFixed(2)}</strong>
                </div>
                <div style={summaryRowStyle}>
                  <span>已支付</span>
                  <strong>RM {totalPaidAmount.toFixed(2)}</strong>
                </div>
                <div style={summaryRowStyle}>
                  <span>待支付</span>
                  <strong style={remaining > 0 ? amountTextStyle : paidTextStyle}>
                    RM {remaining.toFixed(2)}
                  </strong>
                </div>
              </div>

              {remaining <= 0 ? (
                <div style={placeholderStyle}>您已经完成支付，功德圆满。</div>
              ) : (
                <div style={formStyle}>
                  <label style={fieldStyle}>
                    <span style={fieldLabelStyle}>支付方式</span>
                    <select
                      style={inputStyle}
                      value={method}
                      onChange={(event) =>
                        setMethod(event.target.value as "scan" | "transfer" | "cash")
                      }
                    >
                      <option value="scan">扫码支付（默认）</option>
                      <option value="transfer">银行转账</option>
                      <option value="cash">线下现金</option>
                    </select>
                  </label>

                  <div style={infoCardStyle}>
                    {method === "scan" ? (
                      <div style={centeredStyle}>
                        <canvas ref={qrCanvasRef} />
                        <div style={metaStyle}>请使用银行 App / TNG 扫码支付</div>
                      </div>
                    ) : null}
                    {method === "transfer" ? (
                      <div style={stackStyle}>
                        <div style={orderNameStyle}>银行转账资料</div>
                        <div style={metaStyle}>银行：Public Bank</div>
                        <div style={metaStyle}>账号：3148441033</div>
                      </div>
                    ) : null}
                    {method === "cash" ? (
                      <div style={stackStyle}>
                        <div style={orderNameStyle}>线下现金付款</div>
                        <div style={metaStyle}>联系人：王玉芬老师</div>
                        <div style={metaStyle}>电话：012-739 6596</div>
                      </div>
                    ) : null}
                  </div>

                  {requiresProof ? (
                    <label style={fieldStyle}>
                      <span style={fieldLabelStyle}>付款凭证</span>
                      <input
                        type="file"
                        style={inputStyle}
                        onChange={(event) => setFile(event.target.files?.[0] || null)}
                      />
                    </label>
                  ) : null}

                  <label style={fieldStyle}>
                    <span style={fieldLabelStyle}>付款人姓名</span>
                    <input
                      style={inputStyle}
                      value={payerName}
                      placeholder="NRIC NAME"
                      onChange={(event) =>
                        setPayerName(event.target.value.toUpperCase().replace(/[^A-Z ]+/g, ""))
                      }
                    />
                  </label>

                  <div style={fieldStyle}>
                    <span style={fieldLabelStyle}>付款人电话</span>
                    <div style={infoInlineStyle}>
                      手机号将自动使用当前设备绑定号码：{phone || "未识别"}
                    </div>
                  </div>

                  <button
                    type="button"
                    style={primaryButtonStyle}
                    disabled={saving}
                    onClick={() => void submitPayment()}
                  >
                    {saving ? "保存中…" : "保存付款"}
                  </button>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  padding: "24px",
  background:
    "radial-gradient(circle at top, var(--x-color-accent-tint) 0%, transparent 38%), linear-gradient(180deg, var(--x-color-canvas) 0%, var(--x-color-canvas-alt) 100%)",
  boxSizing: "border-box",
};
const shellStyle: CSSProperties = { maxWidth: "760px", margin: "0 auto", display: "grid", gap: "16px" };
const headerStyle: CSSProperties = { display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" };
const eyebrowStyle: CSSProperties = { fontSize: "12px", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--x-color-ink-muted)" };
const titleStyle: CSSProperties = { margin: "6px 0 0", fontSize: "30px", color: "var(--x-color-ink)" };
const cardStyle: CSSProperties = {
  background: "var(--x-color-panel-strong)",
  border: "1px solid var(--x-color-line-soft)",
  boxShadow: "0 24px 48px var(--x-color-shadow)",
  borderRadius: "20px",
  padding: "20px",
  display: "grid",
  gap: "14px",
};
const sectionTitleStyle: CSSProperties = { fontSize: "20px", fontWeight: 900, color: "var(--x-color-ink)" };
const stackStyle: CSSProperties = { display: "grid", gap: "10px" };
const orderRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "center",
  padding: "12px",
  borderRadius: "12px",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line-soft)",
};
const paymentRowStyle: CSSProperties = {
  ...orderRowStyle,
  background: "var(--x-color-accent-soft)",
  border: "1px solid var(--x-color-accent-border)",
};
const orderNameStyle: CSSProperties = { fontWeight: 800, color: "var(--x-color-ink)" };
const metaStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };
const amountStyle: CSSProperties = { fontWeight: 900, color: "var(--x-color-accent-strong)" };
const formStyle: CSSProperties = { display: "grid", gap: "14px" };
const fieldStyle: CSSProperties = { display: "grid", gap: "6px" };
const fieldLabelStyle: CSSProperties = { fontSize: "13px", fontWeight: 700, color: "var(--x-color-ink)" };
const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "10px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  boxSizing: "border-box",
};
const primaryButtonStyle: CSSProperties = {
  padding: "14px 18px",
  borderRadius: "14px",
  border: "none",
  background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-accent-strong))",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};
const secondaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "12px",
  border: "1px solid var(--x-color-accent-border)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-accent-strong)",
  fontWeight: 700,
  cursor: "pointer",
};
const placeholderStyle: CSSProperties = {
  padding: "18px",
  borderRadius: "12px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  border: "1px solid var(--x-color-line-soft)",
};
const infoCardStyle: CSSProperties = {
  padding: "14px",
  borderRadius: "14px",
  background: "var(--x-color-warning-tint)",
  border: "1px solid var(--x-color-warning-border)",
};
const centeredStyle: CSSProperties = { display: "grid", justifyItems: "center", gap: "10px" };
const infoInlineStyle: CSSProperties = {
  padding: "12px",
  borderRadius: "10px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  border: "1px solid var(--x-color-line-soft)",
};
const summaryCardStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  padding: "14px",
  borderRadius: "14px",
  background: "var(--x-color-info-tint)",
  border: "1px solid var(--x-color-line-soft)",
};
const summaryRowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: "12px" };
const amountTextStyle: CSSProperties = { color: "var(--x-color-warning)" };
const paidTextStyle: CSSProperties = { color: "var(--x-color-success)" };
const successBannerStyle: CSSProperties = {
  padding: "14px 16px",
  borderRadius: "12px",
  background: "var(--x-color-success-soft)",
  color: "var(--x-color-success)",
};
const errorBannerStyle: CSSProperties = {
  padding: "14px 16px",
  borderRadius: "12px",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
};
