import { getMaxZIndex } from "../../get_Max_zindex.js";
import { open_parental_form } from "../parental/modal.js";
import {
  buildExtraFieldsPayload,
  createStyledField,
  createTwoColumnRow,
  normalizeExtraFieldOptions,
} from "./utils.js";
import { available_time_slot_json } from "./state.js";
import {
  clearRegisterProfile,
  loadRegisterProfile,
  saveRegisterProfile,
} from "./profile_storage.js";

export function openFormFieldsModal(
  form,
  nricPayload,
  parentalPayload = null,
  options = {},
) {
  const { onBack = null, parentalPrefill = null } = options;
  const parentalRequired = Boolean(nricPayload?.parental_form_required);
  console.log("Opening form fields modal with:", parentalPayload);
  const savedProfile = loadRegisterProfile();
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: 0,
    zIndex: getMaxZIndex() + 1,
    background: "rgba(0,0,0,.35)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "16px",
    boxSizing: "border-box",
  });

  const modal = document.createElement("div");
  Object.assign(modal.style, {
    width: "100%",
    maxWidth: "720px",
    maxHeight: "90vh",
    background: "rgba(255,255,255,.92)",
    borderRadius: "16px",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 30px 80px rgba(0,0,0,.35)",
  });

  const header = document.createElement("div");
  Object.assign(header.style, {
    padding: "14px 16px",
    borderBottom: "1px solid rgba(0,0,0,.08)",
    fontWeight: "900",
  });
  header.textContent = "报名资料";

  const body = document.createElement("div");
  Object.assign(body.style, {
    padding: "16px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  });

  const gender = document.createElement("select");
  gender.innerHTML = `
    <option value="">请选择</option>
    <option value="男">男</option>
    <option value="女">女</option>
  `;
  gender.value = savedProfile.gender || "";

  const email = document.createElement("input");
  email.type = "email";
  email.placeholder = "example@email.com";
  email.value = savedProfile.email || "";

  const address = document.createElement("textarea");
  address.rows = 3;
  address.placeholder = "请输入居住地址";

  const firstRowFields = [createStyledField("性别", gender)];
  if (form.email) {
    firstRowFields.push(createStyledField("邮箱", email));
  }
  if (firstRowFields.length === 2) {
    body.append(createTwoColumnRow(firstRowFields[0], firstRowFields[1]));
  } else {
    body.append(firstRowFields[0]);
  }

  const p1 = document.createElement("input");
  p1.placeholder = "称呼/关系（例：爸爸/妈妈/监护人）";
  p1.value = parentalPayload?.parent_cn || savedProfile.parent_1 || savedProfile.parent_cn || "";

  const p1phone = document.createElement("input");
  p1phone.placeholder = "联络号码";
  p1phone.inputMode = "numeric";
  p1phone.value = parentalPayload?.parent_phone || savedProfile.parent_1_phone || savedProfile.parent_phone || "";

  if (form.parent_1) {
    const parent1Fields = [];
    parent1Fields.push(createStyledField("紧急联络人 1（称呼）", p1));
    parent1Fields.push(createStyledField("紧急联络人 1（电话）", p1phone));
    if (parent1Fields.length === 2) {
      body.append(createTwoColumnRow(parent1Fields[0], parent1Fields[1]));
    } else if (parent1Fields.length === 1) {
      body.append(parent1Fields[0]);
    }
  }

  const p2 = document.createElement("input");
  p2.placeholder = "称呼/关系（可留空）";
  p2.value = savedProfile.parent_2 || "";

  const p2phone = document.createElement("input");
  p2phone.placeholder = "联络号码（可留空）";
  p2phone.inputMode = "numeric";
  p2phone.value = savedProfile.parent_2_phone || "";

  if (form.parent_2) {
    const parent2Fields = [];
    parent2Fields.push(createStyledField("紧急联络人 2（称呼）", p2));
    parent2Fields.push(createStyledField("紧急联络人 2（电话）", p2phone));
    if (parent2Fields.length === 2) {
      body.append(createTwoColumnRow(parent2Fields[0], parent2Fields[1]));
    } else if (parent2Fields.length === 1) {
      body.append(parent2Fields[0]);
    }
  }

  const medical = document.createElement("textarea");
  medical.rows = 3;
  medical.placeholder = "医疗备注（可留空）";

  const allergy = document.createElement("textarea");
  allergy.rows = 3;
  allergy.placeholder = "过敏信息（可留空）";

  const otherRemark = document.createElement("textarea");
  otherRemark.rows = 3;
  otherRemark.placeholder = "其他备注（可留空）";

  if (form.address) {
    body.append(createStyledField("居住地址", address));
  }
  if (form.medical) {
    body.append(createStyledField("医疗备注", medical));
  }
  if (form.allergy) {
    body.append(createStyledField("过敏", allergy));
  }
  if (form.other_remark) {
    body.append(createStyledField("其他备注", otherRemark));
  }

  const cfgs = Array.isArray(form.extra_field_configs)
    ? form.extra_field_configs
    : [];
  if (cfgs.length) {
    const secTitle = document.createElement("div");
    secTitle.textContent = "其他选项";
    Object.assign(secTitle.style, { fontWeight: "900", marginTop: "6px" });
    body.appendChild(secTitle);
  }
  console.log("extra_field_configs =", cfgs);

  const extraValues = {};
  cfgs
    .slice()
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    .forEach((cfg) => {
      const fieldKey = `field_${cfg.id}`;
      const label = cfg.label || fieldKey;
      const type = (cfg.field_type || "text").toLowerCase();

      if (type === "checkbox") {
        const wrap = document.createElement("div");
        Object.assign(wrap.style, {
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "10px 12px",
          borderRadius: "12px",
          border: "1px solid rgba(0,0,0,.10)",
          background: "rgba(255,255,255,.75)",
        });

        const tick = document.createElement("input");
        tick.type = "checkbox";
        tick.checked = false;
        Object.assign(tick.style, {
          width: "18px",
          height: "18px",
          cursor: "pointer",
          accentColor: "rgb(102,126,234)",
        });

        const text = document.createElement("div");
        text.textContent = label;
        Object.assign(text.style, { fontWeight: "800" });

        tick.addEventListener("change", () => {
          extraValues[fieldKey] = tick.checked;
        });
        extraValues[fieldKey] = false;

        wrap.append(tick, text);
        body.appendChild(wrap);
        return;
      }

      if (type === "select") {
        const sel = document.createElement("select");
        const opts = normalizeExtraFieldOptions(cfg.options);
        sel.innerHTML =
          `<option value="">请选择</option>` +
          opts
            .map((o) => `<option value="${String(o)}">${String(o)}</option>`)
            .join("");
        sel.addEventListener("change", () => {
          extraValues[fieldKey] = sel.value;
        });
        extraValues[fieldKey] = "";
        body.appendChild(createStyledField(label, sel));
        return;
      }

      if (type === "textarea") {
        const ta = document.createElement("textarea");
        ta.rows = 3;
        ta.placeholder = "请输入";
        ta.addEventListener("input", () => {
          extraValues[fieldKey] = ta.value;
        });
        extraValues[fieldKey] = "";
        body.appendChild(createStyledField(label, ta));
        return;
      }

      const inp = document.createElement("input");
      inp.type = type === "number" || type === "date" ? type : "text";
      inp.placeholder = "请输入";
      inp.addEventListener("input", () => {
        extraValues[fieldKey] = type === "number" ? inp.value.trim() : inp.value;
      });
      extraValues[fieldKey] = "";
      body.appendChild(createStyledField(label, inp));
    });

  const footer = document.createElement("div");
  Object.assign(footer.style, {
    padding: "14px 16px",
    borderTop: "1px solid rgba(0,0,0,.08)",
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
    background: "rgba(255,255,255,.7)",
  });

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.textContent = "清除本地资料";
  Object.assign(clearBtn.style, {
    border: "1px solid rgba(148,163,184,.28)",
    borderRadius: "12px",
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: "800",
    background: "#fff",
    color: "#334155",
  });
  clearBtn.onclick = () => {
    clearRegisterProfile();
    gender.value = "";
    email.value = "";
    p1.value = "";
    p1phone.value = "";
    p2.value = "";
    p2phone.value = "";
    medical.value = "";
    allergy.value = "";
    address.value = "";
    otherRemark.value = "";
  };

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.textContent = "返回";
  Object.assign(backBtn.style, {
    border: "1px solid rgba(148,163,184,.28)",
    borderRadius: "12px",
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: "800",
    background: "#fff",
    color: "#334155",
  });
  backBtn.onclick = () => {
    overlay.remove();
    if (typeof onBack === "function") {
      onBack();
    }
  };

  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  // 有家长同意书时，这里先「下一步」进入同意书；同意书里点「确认报名」才真正提交。
  submitBtn.textContent = parentalRequired ? "下一步" : "确认报名";
  Object.assign(submitBtn.style, {
    border: "none",
    borderRadius: "12px",
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: "900",
    background: "linear-gradient(135deg, rgb(102,126,234), rgb(118,75,162))",
    color: "#fff",
  });

  function submitRegistration(formPayload) {
    console.log("final_payload =", formPayload);
    fetch(`/api/form/register/${form.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formPayload),
    })
      .then(async (res) => {
        const out = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.error("❌ register error:", res.status, out);
          alert(out.message || `提交失败 (${res.status})`);
          return;
        }
        console.log("✅ register success:", out);
        alert(out.message || "报名成功");
        const hasFees = Array.isArray(form.fees) && form.fees.length > 0;
        window.location.href = hasFees
          ? `/api/form/pay_register/${form.id}`
          : "https://utbabuddha.com";
      })
      .catch((err) => {
        console.error("🔥 fetch failed:", err);
        alert("网络错误 / 服务器无响应");
      });
  }

  submitBtn.onclick = async () => {
    if (!gender.value) {
      alert("请选择性别");
      return;
    }
    if (form.parent_1 && !p1.value.trim()) {
      alert("请填写紧急联络人 1（称呼）");
      return;
    }
    if (form.parent_1 && !p1phone.value.trim()) {
      alert("请填写紧急联络人 1（电话）");
      return;
    }

    const extraFieldsPayload = buildExtraFieldsPayload(
      extraValues,
      form.extra_field_configs,
    );

    const baseValues = {
      gender: gender.value,
      email: form.email ? email.value.trim() || null : null,
      address: form.address ? address.value.trim() || null : null,
      parent_1: form.parent_1 ? p1.value.trim() || null : null,
      parent_1_phone: form.parent_1 ? p1phone.value.trim() || null : null,
      parent_2: form.parent_2 ? p2.value.trim() || null : null,
      parent_2_phone: form.parent_2 ? p2phone.value.trim() || null : null,
      medical: form.medical ? medical.value.trim() || null : null,
      allergy: form.allergy ? allergy.value.trim() || null : null,
      other_remark: form.other_remark ? otherRemark.value.trim() || null : null,
    };

    saveRegisterProfile({
      ...nricPayload,
      gender: gender.value,
      email: form.email ? email.value.trim() || "" : "",
      address: form.address ? address.value.trim() || "" : "",
      parent_1: form.parent_1 ? p1.value.trim() : "",
      parent_1_phone: form.parent_1 ? p1phone.value.trim() : "",
      parent_2: form.parent_2 ? p2.value.trim() || "" : "",
      parent_2_phone: form.parent_2 ? p2phone.value.trim() || "" : "",
      ...(parentalPayload || {}),
    });

    // 家长同意书是最后一步：填完点「确认报名」直接提交，不下载 PDF。
    let parental = parentalPayload;
    if (parentalRequired) {
      const prefill = parentalPrefill || {
        child_cn: nricPayload.name_cn,
        child_en: nricPayload.name,
        child_nric: nricPayload.nric,
        child_phone: nricPayload.phone,
      };
      const parent = await open_parental_form(form, nricPayload, prefill, false, true, {
        skipPdfExport: true,
        okLabel: "确认报名",
        nullOnClose: true,
      });
      if (!parent) {
        return;
      }
      saveRegisterProfile(parent);
      parental = parent;
    }

    submitRegistration({
      ...nricPayload,
      ...baseValues,
      available_time_slot_json,
      extra_fields: extraFieldsPayload,
      parental_payload: parental || null,
    });
  };

  const left = document.createElement("div");
  Object.assign(left.style, {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
  });
  left.append(backBtn, clearBtn);

  footer.append(left, submitBtn);

  modal.append(header, body, footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
