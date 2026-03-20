export function buildHeader(lastEvent) {
  const header = document.createElement("div");
  Object.assign(header.style, {
    padding: "14px 16px",
    borderBottom: "1px solid rgba(0,0,0,.08)",
    display: "flex",
    gap: "14px",
    alignItems: "flex-start",
  });

  const logo = document.createElement("img");
  logo.src = "https://utbabuddha.com/favicon.ico";
  logo.alt = "UTBA Logo";
  Object.assign(logo.style, {
    width: "56px",
    height: "56px",
    borderRadius: "12px",
    objectFit: "contain",
    background: "rgba(0,0,0,.05)",
    flexShrink: "0",
  });

  const infoWrap = document.createElement("div");
  Object.assign(infoWrap.style, {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    lineHeight: "1.4",
  });

  const orgCn = document.createElement("div");
  orgCn.textContent = "地南佛学会";
  Object.assign(orgCn.style, {
    fontWeight: "900",
    fontSize: "15px",
  });

  const orgBm = document.createElement("div");
  orgBm.textContent = "PERTUBUHAN PENGANUT AGAMA BUDDHA ULU TIRAM";
  Object.assign(orgBm.style, {
    fontSize: "12px",
    fontWeight: "700",
    opacity: "0.9",
  });

  const orgEn = document.createElement("div");
  orgEn.textContent = "ULU TIRAM BUDDHIST ASSOCIATION (3003/04 JOHOR)";
  Object.assign(orgEn.style, {
    fontSize: "12px",
    opacity: "0.85",
  });

  const orgAddr = document.createElement("div");
  orgAddr.textContent =
    "21, JALAN RESAM 13, TAMAN BUKIT TIRAM, 81800 ULU TIRAM, JOHOR DARUL TAKZIM";
  Object.assign(orgAddr.style, {
    fontSize: "11px",
    opacity: "0.75",
    marginTop: "2px",
  });

  const title = document.createElement("div");
  title.textContent = lastEvent?.title
    ? `${lastEvent.title} 家长同意书`
    : "家长同意书";
  Object.assign(title.style, {
    marginTop: "6px",
    fontWeight: "900",
    fontSize: "16px",
  });

  infoWrap.append(orgCn, orgBm, orgEn, orgAddr, title);
  header.append(logo, infoWrap);
  return header;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function fmtDate(d) {
  return `${d.getFullYear()}年${pad2(d.getMonth() + 1)}月${pad2(d.getDate())}日`;
}

function fmtClock(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function buildBrief(lastEvent) {
  const ev = lastEvent?.events?.[0] || null;
  const startDT = ev?.datetime ? new Date(ev.datetime) : null;
  const endDT = ev?.end_datetime ? new Date(ev.end_datetime) : null;
  const locationText = ev?.location || "—";

  const brief = document.createElement("div");
  Object.assign(brief.style, {
    padding: "14px 14px",
    borderRadius: "14px",
    border: "1px solid rgba(0,0,0,.08)",
    background: "rgba(255,255,255,.75)",
    fontSize: "13px",
    lineHeight: "1.7",
    whiteSpace: "pre-wrap",
  });

  brief.textContent =
    "简章\n" +
    `地点：${locationText}\n` +
    (startDT && endDT
      ? `日期：${fmtDate(startDT)} - ${fmtDate(endDT)}\n`
      : "日期：—\n") +
    (startDT
      ? `报到时间：${fmtDate(startDT)} ${fmtClock(startDT)}\n`
      : "报到时间：—\n") +
    (endDT
      ? `结束时间：${fmtDate(endDT)} ${fmtClock(endDT)}\n`
      : "结束时间：—\n") +
    "联络人：刘佳颖学姐（010-2369449）";

  return brief;
}

function mkInlineInput(placeholder, width = "180px") {
  const inp = document.createElement("input");
  inp.placeholder = placeholder;
  Object.assign(inp.style, {
    display: "inline-block",
    width,
    padding: "6px 8px",
    borderRadius: "10px",
    border: "1px solid rgba(0,0,0,.18)",
    background: "rgba(255,255,255,.9)",
    fontSize: "13px",
    outline: "none",
    verticalAlign: "middle",
    margin: "0 6px",
  });
  return inp;
}

function mkDateInput(value) {
  const date = document.createElement("input");
  date.type = "date";
  date.value = value || "";
  Object.assign(date.style, {
    display: "inline-block",
    width: "170px",
    padding: "6px 8px",
    borderRadius: "10px",
    border: "1px solid rgba(0,0,0,.18)",
    background: "rgba(255,255,255,.9)",
    fontSize: "13px",
    outline: "none",
    verticalAlign: "middle",
    margin: "0 6px",
  });
  return date;
}

export function buildAgreementSection({ lastEvent, payload, parent }) {
  const agreeBox = document.createElement("div");
  Object.assign(agreeBox.style, {
    padding: "14px 14px",
    borderRadius: "14px",
    border: "1px solid rgba(0,0,0,.08)",
    background: "rgba(255,255,255,.75)",
    fontSize: "13px",
    lineHeight: "2",
  });

  const fields = {
    p_cn: mkInlineInput("家长姓名（中）", "160px"),
    p_en: mkInlineInput("Parent Name (EN)", "220px"),
    p_nric: mkInlineInput("家长 NRIC", "180px"),
    child_cn: mkInlineInput("学员姓名（中）", "160px"),
    child_en: mkInlineInput("Student Name (EN)", "220px"),
    child_nric: mkInlineInput("学员 NRIC", "180px"),
    p_phone: mkInlineInput("家长电话", "160px"),
    c_phone: mkInlineInput("学员电话", "160px"),
    sign: mkInlineInput("家长/监护人签名", "220px"),
    date: mkDateInput(parent.sign_date || ""),
  };

  fields.p_cn.value = parent.parent_cn || "";
  fields.p_en.value = parent.parent_en || "";
  fields.p_nric.value = parent.parent_nric || "";
  fields.child_cn.value = parent.child_cn || (payload?.name_cn || "").trim();
  fields.child_en.value = parent.child_en || (payload?.name || "").trim();
  fields.child_nric.value = parent.child_nric || (payload?.nric || "").trim();
  fields.p_phone.value = parent.parent_phone || "";
  fields.c_phone.value = parent.child_phone || (payload?.phone || "").trim();
  fields.sign.value = parent.sign || "";

  const sync = () => {
    parent.parent_cn = (fields.p_cn.value || "").trim();
    parent.parent_en = (fields.p_en.value || "").trim();
    parent.parent_nric = (fields.p_nric.value || "").trim();
    parent.parent_phone = (fields.p_phone.value || "").trim();
    parent.child_cn = (fields.child_cn.value || "").trim();
    parent.child_en = (fields.child_en.value || "").trim();
    parent.child_nric = (fields.child_nric.value || "").trim();
    parent.child_phone = (fields.c_phone.value || "").trim();
  };

  [
    fields.p_cn,
    fields.p_en,
    fields.p_nric,
    fields.p_phone,
    fields.child_cn,
    fields.child_en,
    fields.child_nric,
    fields.c_phone,
  ].forEach((el) => el.addEventListener("input", sync));

  agreeBox.append(
    document.createTextNode("家长/监护人同意书"),
    document.createElement("br"),
    document.createTextNode("本人（家长/监护人姓名）（中）"),
    fields.p_cn,
    document.createTextNode("（英）"),
    fields.p_en,
    document.createTextNode("（NRIC："),
    fields.p_nric,
    document.createTextNode("）允许吾子/女（中）"),
    fields.child_cn,
    document.createTextNode("（英）"),
    fields.child_en,
    document.createTextNode("（NRIC："),
    fields.child_nric,
    document.createTextNode("）参加贵会所办之 "),
    document.createTextNode(lastEvent?.event_name || "本活动"),
    document.createTextNode(
      "。本人深悉贵会将会妥善地安排及监督小儿/小女，如在上述期间有任何意外发生，本人将不会归咎贵会。",
    ),
    document.createElement("br"),
    document.createElement("br"),
    document.createTextNode("家长联络电话："),
    fields.p_phone,
    document.createTextNode("学员联络电话："),
    fields.c_phone,
  );

  return { agreeBox, fields, sync };
}
