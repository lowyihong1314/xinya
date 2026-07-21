// Ported to TS from static/js/form/payment/age.js.
// Note: the backend (_calc_age_from_nric) uses birth-YEAR-only age; this
// client helper is only for instant display while typing — the server age
// returned by the quote endpoint is authoritative.

export function parseDobFromNric(nricRaw: string): Date | null {
  const digits = String(nricRaw || "").replace(/\D/g, "");
  if (digits.length < 6) {
    return null;
  }

  const today = new Date();
  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) {
    return null;
  }

  const currentYY = Number(String(today.getFullYear()).slice(-2));
  const year = yy > currentYY ? 1900 + yy : 2000 + yy;
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

export function calcAgeFromDob(dob: Date | null): number | null {
  if (!dob) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  if (
    today.getMonth() < dob.getMonth() ||
    (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())
  ) {
    age -= 1;
  }

  if (!Number.isFinite(age) || age < 0 || age > 120) {
    return null;
  }
  return age;
}

export function calcAgeFromNric(nricRaw: string): number | null {
  return calcAgeFromDob(parseDobFromNric(nricRaw));
}
