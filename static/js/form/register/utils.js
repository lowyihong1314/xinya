export function checkImageOk(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;

    setTimeout(() => resolve(false), 8000);
  });
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function fmtClock(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fmtDateTime(d) {
  if (!d) {
    return "--";
  }

  const y = d.getFullYear();
  const mo = pad2(d.getMonth() + 1);
  const da = pad2(d.getDate());
  return `${y}-${mo}-${da} ${fmtClock(d)}`;
}

export function parseDateOnly(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function getMalaysiaToday() {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kuala_Lumpur",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const valueByType = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    const today = parseDateOnly(
      `${valueByType.year}-${valueByType.month}-${valueByType.day}`,
    );
    if (today) {
      return today;
    }
  } catch (error) {
    console.warn("Unable to resolve Malaysia date for form deadline", error);
  }

  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function isFormRegistrationClosed(form) {
  if (form?.registration_closed === true) {
    return true;
  }

  const expiredDate = parseDateOnly(form?.expired);
  if (!expiredDate) {
    return false;
  }

  const today = getMalaysiaToday();
  return today.getTime() > expiredDate.getTime();
}

export function addMinutes(base, mins) {
  return new Date(base.getTime() + mins * 60000);
}

export function createField(labelText, inputEl) {
  const wrap = document.createElement("div");
  Object.assign(wrap.style, {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  });

  const lab = document.createElement("div");
  lab.textContent = labelText;
  Object.assign(lab.style, {
    fontWeight: "800",
    fontSize: "13px",
    opacity: 0.9,
  });

  Object.assign(inputEl.style, {
    padding: "10px 12px",
    borderRadius: "12px",
    border: "1px solid rgba(0,0,0,.12)",
    background: "rgba(255,255,255,.85)",
    fontSize: "14px",
    outline: "none",
  });

  wrap.append(lab, inputEl);
  return wrap;
}

export function createStyledField(labelText, el) {
  const wrap = document.createElement("div");
  Object.assign(wrap.style, {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  });

  const lab = document.createElement("div");
  lab.textContent = labelText;
  Object.assign(lab.style, {
    fontWeight: "800",
    fontSize: "13px",
    opacity: 0.9,
  });

  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    Object.assign(el.style, {
      padding: "10px 12px",
      borderRadius: "12px",
      border: "1px solid rgba(0,0,0,.12)",
      background: "rgba(255,255,255,.85)",
      fontSize: "14px",
      outline: "none",
      boxSizing: "border-box",
    });
  }

  wrap.append(lab, el);
  return wrap;
}

export function createTwoColumnRow(left, right) {
  const row = document.createElement("div");
  Object.assign(row.style, {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "10px",
  });
  row.append(left, right);
  return row;
}

export function normalizeExtraFieldOptions(rawOptions) {
  if (Array.isArray(rawOptions)) {
    return rawOptions
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  if (typeof rawOptions === "string") {
    return rawOptions
      .replace(/\r/g, "\n")
      .replace(/,/g, "\n")
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

export function buildExtraFieldsPayload(extraValues, extraFieldConfigs) {
  if (!extraValues || !Array.isArray(extraFieldConfigs)) {
    return [];
  }

  return extraFieldConfigs
    .map((cfg) => {
      const val = extraValues[`field_${cfg.id}`];
      if (val === undefined) {
        return null;
      }

      return {
        field_config_id: cfg.id,
        field_value: val,
      };
    })
    .filter(Boolean);
}
