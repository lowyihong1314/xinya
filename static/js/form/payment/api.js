export async function fetchPaymentQuote(formId, nric) {
  const response = await fetch(
    `/api/form/payment_quote/${formId}?nric=${encodeURIComponent(nric)}`,
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "读取付款报价失败");
  }
  return payload;
}

export async function createPayment(formId, formData) {
  const response = await fetch(`/api/form/payment/create/${formId}`, {
    method: "POST",
    body: formData,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "提交付款资料失败");
  }
  return payload;
}
