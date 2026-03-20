import { open_parental_form } from "../parental/modal.js";
import { getMaxZIndex } from "../../get_Max_zindex.js";
import { openFormFieldsModal } from "./form_fields.js";
import { createField } from "./utils.js";
import {
  clearRegisterProfile,
  loadRegisterProfile,
  saveRegisterProfile,
} from "./profile_storage.js";

export function openNricModal(form, options = {}) {
  const { onBack = null } = options;
  const savedProfile = loadRegisterProfile();
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: 0,
    zIndex: getMaxZIndex() + 1,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "16px",
    boxSizing: "border-box",
    background: "rgba(0,0,0,.35)",
  });

  const modal = document.createElement("div");
  Object.assign(modal.style, {
    width: "100%",
    maxWidth: "520px",
    background: "#ffffffd0",
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
  header.textContent = "请输入您的身份证信息";

  const body = document.createElement("div");
  Object.assign(body.style, {
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  });

  const inputNameCn = document.createElement("input");
  inputNameCn.placeholder = "中文名";
  inputNameCn.autocomplete = "name";
  inputNameCn.value = savedProfile.name_cn || "";

  const inputPhone = document.createElement("input");
  inputPhone.placeholder = "手机号码 (例如 0123456789)";
  inputPhone.inputMode = "tel";
  inputPhone.autocomplete = "tel";
  inputPhone.value = savedProfile.phone || "";

  const inputName = document.createElement("input");
  inputName.placeholder = "NAME (A-Z, 空格可)";
  inputName.autocomplete = "name";
  inputName.value = savedProfile.name || "";

  const inputIc = document.createElement("input");
  inputIc.placeholder = "IC NO (例如 991031015177)";
  inputIc.inputMode = "numeric";
  inputIc.autocomplete = "off";
  inputIc.value = savedProfile.nric || "";

  const inputAge = document.createElement("input");
  inputAge.placeholder = "AGE";
  inputAge.readOnly = true;

  const inputParental = document.createElement("input");
  inputParental.type = "hidden";
  inputParental.name = "parental_form_required";

  const parentalDisplay = document.createElement("div");
  Object.assign(parentalDisplay.style, {
    padding: "10px 12px",
    borderRadius: "12px",
    fontSize: "14px",
    fontWeight: "700",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    background: "rgba(0,0,0,.04)",
    border: "1px solid rgba(0,0,0,.08)",
  });

  body.append(
    createField("中文名", inputNameCn),
    createField("手机号码", inputPhone),
    createField("IC NAME", inputName),
    createField("IC NO", inputIc),
    createField("AGE", inputAge),
    createField("家长同意书", parentalDisplay),
  );
  body.appendChild(inputParental);

  const today = new Date();

  function renderParentalStatus(need) {
    if (need === null) {
      parentalDisplay.textContent = "—";
      parentalDisplay.style.background = "rgba(0,0,0,.04)";
      parentalDisplay.style.color = "#555";
      return;
    }

    if (need) {
      parentalDisplay.innerHTML = `
      <span style="font-size:18px">⚠️</span>
      <span>需要家长同意书</span>
    `;
      parentalDisplay.style.background = "rgba(239,68,68,.08)";
      parentalDisplay.style.borderColor = "rgba(239,68,68,.25)";
      parentalDisplay.style.color = "rgb(185,28,28)";
      return;
    }

    parentalDisplay.innerHTML = `
      <span style="font-size:18px">✅</span>
      <span>不需要家长同意书</span>
    `;
    parentalDisplay.style.background = "rgba(34,197,94,.10)";
    parentalDisplay.style.borderColor = "rgba(34,197,94,.30)";
    parentalDisplay.style.color = "rgb(22,101,52)";
  }

  function parseDobFromIc(icRaw) {
    const digits = (icRaw || "").replace(/\D/g, "");
    if (digits.length < 6) {
      return null;
    }

    const yy = Number(digits.slice(0, 2));
    const mm = Number(digits.slice(2, 4));
    const dd = Number(digits.slice(4, 6));

    if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) {
      return null;
    }
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
      return null;
    }

    const curYY = Number(String(today.getFullYear()).slice(-2));
    const year = yy > curYY ? 1900 + yy : 2000 + yy;

    const dob = new Date(year, mm - 1, dd);
    if (
      dob.getFullYear() !== year ||
      dob.getMonth() !== mm - 1 ||
      dob.getDate() !== dd
    ) {
      return null;
    }

    return dob;
  }

  function calcAge(dob) {
    if (!dob) {
      return null;
    }

    let age = today.getFullYear() - dob.getFullYear();
    const monthDelta = today.getMonth() - dob.getMonth();
    if (
      monthDelta < 0 ||
      (monthDelta === 0 && today.getDate() < dob.getDate())
    ) {
      age -= 1;
    }
    return age;
  }

  function updateDerived() {
    let nameValue = (inputName.value || "").toUpperCase();
    nameValue = nameValue.replace(/[^A-Z ]/g, "");
    if (nameValue !== inputName.value) {
      inputName.value = nameValue;
    }

    const icDigits = (inputIc.value || "").replace(/\D/g, "");
    if (icDigits !== inputIc.value) {
      inputIc.value = icDigits;
    }

    const dob = parseDobFromIc(icDigits);
    const age = calcAge(dob);

    if (age === null || !Number.isFinite(age) || age < 0 || age > 120) {
      inputAge.value = "";
      inputParental.value = "";
      renderParentalStatus(null);
      return;
    }

    inputAge.value = String(age);

    const needParental = Boolean(form?.parental_form) && age < 19;
    inputParental.value = needParental ? "true" : "false";
    renderParentalStatus(needParental);
  }

  inputName.addEventListener("input", updateDerived);
  inputIc.addEventListener("input", updateDerived);

  const footer = document.createElement("div");
  Object.assign(footer.style, {
    padding: "14px 16px",
    borderTop: "1px solid rgba(0,0,0,.08)",
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
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
    inputNameCn.value = "";
    inputPhone.value = "";
    inputName.value = "";
    inputIc.value = "";
    inputAge.value = "";
    inputParental.value = "";
    renderParentalStatus(null);
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

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.textContent = "下一步";
  Object.assign(nextBtn.style, {
    border: "none",
    borderRadius: "12px",
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: "900",
    background: "linear-gradient(135deg, rgb(102,126,234), rgb(118,75,162))",
    color: "#fff",
  });

  nextBtn.onclick = async () => {
    updateDerived();

    const name = (inputName.value || "").trim();
    const nameCn = (inputNameCn.value || "").trim();
    const phone = (inputPhone.value || "").trim();
    const icNo = (inputIc.value || "").trim();
    const age = Number(inputAge.value);

    if (!name) {
      alert("NAME 不能为空");
      return;
    }
    if (!/^[A-Z ]+$/.test(name)) {
      alert("NAME 只能是 A-Z 和空格（不允许小写/符号）");
      return;
    }
    if (icNo.length < 6) {
      alert("IC NO 至少需要前 6 位（YYMMDD）");
      return;
    }
    if (!Number.isFinite(age)) {
      alert("无法判断年龄，请检查 IC NO");
      return;
    }

    const parentalFormRequired = inputParental.value === "true";

    const payload = {
      name,
      phone,
      nric: icNo,
      age,
      parental_form_required: parentalFormRequired,
      name_cn: nameCn,
    };

    saveRegisterProfile(payload);
    console.log("nric_payload =", payload);

    let parent = null;
    if (parentalFormRequired) {
      parent = await open_parental_form(form, payload, {
        parent_cn: savedProfile.parent_cn,
        parent_en: savedProfile.parent_en,
        parent_nric: savedProfile.parent_nric,
        parent_phone: savedProfile.parent_phone,
        child_cn: savedProfile.child_cn || nameCn,
        child_en: savedProfile.child_en || name,
        child_nric: savedProfile.child_nric || icNo,
        child_phone: savedProfile.child_phone || phone,
      });
      if (!parent) {
        return;
      }
      saveRegisterProfile(parent);
    }

    openFormFieldsModal(form, payload, parent, {
      onBack: () => openNricModal(form, options),
    });
    overlay.remove();
  };

  const left = document.createElement("div");
  Object.assign(left.style, {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
  });
  left.append(backBtn, clearBtn);

  footer.append(left, nextBtn);
  modal.append(header, body, footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  updateDerived();
}
