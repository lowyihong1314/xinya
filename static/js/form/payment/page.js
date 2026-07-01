import { createPayment, fetchPaymentQuote } from "./api.js";
import { calcAgeFromNric } from "./age.js";
import { createButton, createCard, createField } from "./ui.js";
import Swal from "sweetalert2";

function sortFeesNewestFirst(fees) {
  return [...(Array.isArray(fees) ? fees : [])].sort((a, b) => {
    const left = new Date(a.created_at || 0).getTime();
    const right = new Date(b.created_at || 0).getTime();
    return right - left || Number(b.id || 0) - Number(a.id || 0);
  });
}

function matchLocalFees(form, age) {
  return sortFeesNewestFirst(form?.fees).filter((fee) => {
    if (fee.age_range_from != null && age < Number(fee.age_range_from)) return false;
    if (fee.age_range_to != null && age > Number(fee.age_range_to)) return false;
    return true;
  });
}

function dedupeFees(fees) {
  const seen = new Set();
  return (Array.isArray(fees) ? fees : []).filter((fee) => {
    const key = `${fee.form?.id || "form"}:${fee.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatAmount(amount) {
  return `RM ${Number(amount || 0).toFixed(2)}`;
}

function createHint(text, tone = "muted") {
  const el = document.createElement("div");
  Object.assign(el.style, {
    fontSize: "13px",
    minHeight: "20px",
    color: tone === "error" ? "#b91c1c" : tone === "success" ? "#166534" : "#64748b",
  });
  el.textContent = text;
  return el;
}

function createFeeCard(fee, onSelect) {
  const card = document.createElement("button");
  card.type = "button";
  Object.assign(card.style, {
    display: "grid",
    gap: "10px",
    textAlign: "left",
    padding: "16px",
    borderRadius: "18px",
    border: "1px solid rgba(15,118,110,.18)",
    background: "rgba(255,255,255,.94)",
    cursor: "pointer",
  });

  const top = document.createElement("div");
  Object.assign(top.style, {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
  });

  const titleWrap = document.createElement("div");
  const title = document.createElement("div");
  title.textContent = fee.category || "收费项";
  Object.assign(title.style, {
    fontSize: "17px",
    fontWeight: "800",
    color: "#0f172a",
  });

  const source = document.createElement("div");
  source.textContent = fee.form?.title ? `来源：${fee.form.title}` : "来源：当前表单";
  Object.assign(source.style, {
    fontSize: "12px",
    color: "#64748b",
    marginTop: "4px",
  });
  titleWrap.append(title, source);

  const amount = document.createElement("div");
  amount.textContent = formatAmount(fee.amount);
  Object.assign(amount.style, {
    fontSize: "24px",
    fontWeight: "900",
    color: "#0f766e",
    whiteSpace: "nowrap",
  });
  top.append(titleWrap, amount);

  const meta = document.createElement("div");
  meta.textContent = `适用年龄：${fee.age_range_from ?? "-"} 至 ${fee.age_range_to ?? "-"}`;
  Object.assign(meta.style, {
    fontSize: "13px",
    color: "#475569",
  });

  const desc = document.createElement("div");
  desc.textContent = fee.description || "无附加说明";
  Object.assign(desc.style, {
    fontSize: "14px",
    lineHeight: "1.6",
    color: "#334155",
  });

  card.onclick = () => onSelect(fee);
  card.append(top, meta, desc);
  return card;
}

function createPaymentStep(form, nric, fee, onSubmitted) {
  const wrap = document.createElement("div");
  Object.assign(wrap.style, {
    display: "grid",
    gap: "14px",
    padding: "18px",
    borderRadius: "20px",
    border: "1px solid rgba(15,118,110,.16)",
    background: "linear-gradient(180deg, rgba(240,253,250,.94), rgba(248,250,252,.96))",
  });

  const header = document.createElement("div");
  header.textContent = "请支付";
  Object.assign(header.style, {
    fontSize: "18px",
    fontWeight: "900",
    color: "#0f172a",
  });

  const summary = document.createElement("div");
  summary.textContent = `${fee.category || "收费项"} · ${formatAmount(fee.amount)}`;
  Object.assign(summary.style, {
    fontSize: "16px",
    fontWeight: "800",
    color: "#0f766e",
  });

  const imageHint = document.createElement("div");
  imageHint.textContent = fee.image_path ? "请扫码/按图付款，然后上传截图。" : "当前收费项没有收款码图片，请先联系管理员。";
  Object.assign(imageHint.style, {
    fontSize: "13px",
    color: "#475569",
  });

  const proofInput = document.createElement("input");
  proofInput.type = "file";
  proofInput.accept = "image/png,image/jpeg,.png,.jpg,.jpeg";

  const submitHint = createHint("");

  const submitButton = createButton("提交付款截图");
  submitButton.onclick = async () => {
    const file = proofInput.files?.[0];
    if (!file) {
      submitHint.textContent = "请先选择付款截图。";
      submitHint.style.color = "#b91c1c";
      return;
    }

    const formData = new FormData();
    formData.append("nric", nric);
    formData.append("fee_id", String(fee.id));
    formData.append("payment_mode", "QR");
    formData.append("proof_image", file);

    submitButton.disabled = true;
    submitHint.textContent = "提交中...";
    submitHint.style.color = "#64748b";
    try {
      const result = await createPayment(form.id, formData);
      submitHint.textContent = result.message || "付款资料已提交";
      submitHint.style.color = "#166534";
      onSubmitted?.(result);
      await Swal.fire({
        icon: "success",
        title: "上传成功",
        text: result.message || "付款资料已提交",
        confirmButtonText: "确定",
      });
      window.location.assign("/");
    } catch (error) {
      submitHint.textContent = error instanceof Error ? error.message : "提交失败";
      submitHint.style.color = "#b91c1c";
    } finally {
      submitButton.disabled = false;
    }
  };

  wrap.append(header, summary, imageHint);

  if (fee.image_path) {
    const qrImage = document.createElement("img");
    qrImage.src = fee.image_path;
    qrImage.alt = "收款码";
    Object.assign(qrImage.style, {
      width: "100%",
      maxWidth: "320px",
      borderRadius: "18px",
      border: "1px solid rgba(148,163,184,.24)",
      background: "#fff",
      display: "block",
    });
    wrap.appendChild(qrImage);
  }

  wrap.append(createField("付款截图", proofInput), submitButton, submitHint);
  return wrap;
}

export function renderPaymentPage(form) {
  const card = createCard();

  const eyebrow = document.createElement("div");
  eyebrow.textContent = "Pay Register";
  Object.assign(eyebrow.style, {
    fontSize: "12px",
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    color: "#0f766e",
    fontWeight: "900",
  });

  const title = document.createElement("h1");
  title.textContent = form?.title || "报名付款";
  Object.assign(title.style, {
    margin: "0",
    fontSize: "32px",
    lineHeight: "1.05",
    color: "#0f172a",
  });

  const detail = document.createElement("div");
  detail.textContent = "输入 IC，列出所有符合条件的付款选项；选择一项后上传付款截图。";
  Object.assign(detail.style, {
    fontSize: "14px",
    color: "#475569",
    lineHeight: "1.7",
  });

  const nricInput = document.createElement("input");
  nricInput.placeholder = "IC NO (例如 991031015177)";
  nricInput.inputMode = "numeric";

  const ageInput = document.createElement("input");
  ageInput.readOnly = true;
  ageInput.placeholder = "自动计算";

  const status = createHint("");
  const feeList = document.createElement("div");
  Object.assign(feeList.style, {
    display: "grid",
    gap: "12px",
  });

  const paymentStage = document.createElement("div");
  Object.assign(paymentStage.style, {
    display: "grid",
    gap: "12px",
  });

  function updateAge() {
    const digits = String(nricInput.value || "").replace(/\D/g, "");
    if (digits !== nricInput.value) {
      nricInput.value = digits;
    }
    const age = calcAgeFromNric(digits);
    ageInput.value = age == null ? "" : String(age);
    return age;
  }

  async function handleNext() {
    const nric = String(nricInput.value || "").trim();
    const age = updateAge();
    feeList.replaceChildren();
    paymentStage.replaceChildren();

    if (nric.length < 6) {
      status.textContent = "IC 至少需要前 6 位。";
      status.style.color = "#b91c1c";
      return;
    }
    if (age == null) {
      status.textContent = "无法根据 IC 计算年龄。";
      status.style.color = "#b91c1c";
      return;
    }

    status.textContent = "读取付款选项中...";
    status.style.color = "#64748b";

    try {
      const quote = await fetchPaymentQuote(form.id, nric);
      const serverFees = dedupeFees(quote.matching_fees);
      const fallbackFees = matchLocalFees(form, age).map((fee) => ({
        ...fee,
        form: { id: form.id, title: form.title },
      }));
      const fees = serverFees.length ? serverFees : fallbackFees;

      status.textContent = quote.member
        ? `已找到会员资料，年龄 ${quote.age}，请选择付款项。`
        : `未找到历史会员资料，年龄 ${age}，使用当前表单收费项。`;
      status.style.color = "#166534";

      if (!fees.length) {
        feeList.appendChild(createHint("没有符合条件的收费项。", "error"));
        return;
      }

      fees.forEach((fee) => {
        feeList.appendChild(
          createFeeCard(fee, (selectedFee) => {
            paymentStage.replaceChildren(
              createPaymentStep(form, nric, selectedFee, () => {
                status.textContent = "付款资料已提交，等待核对。";
                status.style.color = "#166534";
              }),
            );
          }),
        );
      });
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "读取付款选项失败";
      status.style.color = "#b91c1c";
    }
  }

  const actionRow = document.createElement("div");
  Object.assign(actionRow.style, {
    display: "flex",
    justifyContent: "flex-end",
  });

  const nextButton = createButton("查询付款选项");
  nextButton.onclick = () => {
    void handleNext();
  };

  nricInput.addEventListener("input", () => {
    updateAge();
    status.textContent = "";
  });

  actionRow.appendChild(nextButton);
  card.append(
    eyebrow,
    title,
    detail,
    createField("IC NO", nricInput),
    createField("年龄", ageInput),
    status,
    actionRow,
    feeList,
    paymentStage,
  );

  return card;
}
