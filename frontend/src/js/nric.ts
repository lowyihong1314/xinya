// NRIC 公共工具：从 NRIC 计算年龄。
// 全局年龄规则：只按出生年份计算（当前年份 - 出生年份），不看月份/生日。
// 与后端 app/form/services.py:_calc_age_from_nric 保持一致。

export function getMalaysiaToday() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(partMap.year || "0"),
    month: Number(partMap.month || "0"),
    day: Number(partMap.day || "0"),
  };
}

export function calcAgeFromNric(nric: string | null | undefined): number | null {
  const digits = String(nric || "").replace(/\D/g, "");
  if (digits.length < 6) {
    return null;
  }

  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) {
    return null;
  }

  const today = getMalaysiaToday();
  const currentYY = today.year % 100;
  const year = yy > currentYY ? 1900 + yy : 2000 + yy;
  const dob = new Date(Date.UTC(year, mm - 1, dd));
  if (
    Number.isNaN(dob.getTime()) ||
    dob.getUTCFullYear() !== year ||
    dob.getUTCMonth() !== mm - 1 ||
    dob.getUTCDate() !== dd
  ) {
    return null;
  }

  const age = today.year - year;
  return age >= 0 && age <= 120 ? age : null;
}
