export const PHONE_STORAGE_KEY = "my_phone_number";
export const PHONE_VERIFICATION_STORAGE_KEY = "my_phone_verification";

type PhoneVerificationRecord = {
  phone: string;
  verified: boolean;
  verifiedAt: string;
};

function getDigits(raw: string) {
  return String(raw || "").replace(/\D+/g, "");
}

export function correctPhoneInputMY(raw: string) {
  const digits = getDigits(raw);
  if (!digits) {
    return "";
  }

  if (digits.startsWith("60") && digits.length >= 11 && digits.length <= 12) {
    return `0${digits.slice(2)}`;
  }

  if (digits.startsWith("1") && digits.length >= 9 && digits.length <= 10) {
    return `0${digits}`;
  }

  return digits;
}

export function normalizePhoneMY(raw: string) {
  const digits = getDigits(raw);
  if (!digits) {
    return "";
  }

  if (digits.startsWith("0") && digits.length >= 10 && digits.length <= 11) {
    return `+60${digits.slice(1)}`;
  }

  if (digits.startsWith("60") && digits.length >= 11 && digits.length <= 12) {
    return `+${digits}`;
  }

  if (digits.startsWith("1") && digits.length >= 9 && digits.length <= 10) {
    return `+60${digits}`;
  }

  return "";
}

export function formatPhoneForInput(raw: string) {
  const corrected = correctPhoneInputMY(raw);
  if (!corrected) {
    return "";
  }

  const normalized = normalizePhoneMY(corrected);
  if (!normalized) {
    return corrected;
  }

  return `0${normalized.slice(3)}`;
}

function readVerificationRecord(): PhoneVerificationRecord | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(PHONE_VERIFICATION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as PhoneVerificationRecord | null;
    if (!parsed?.verified) {
      return null;
    }

    const phone = normalizePhoneMY(parsed.phone || "");
    if (!phone) {
      return null;
    }

    return {
      phone,
      verified: true,
      verifiedAt: parsed.verifiedAt || "",
    };
  } catch {
    return null;
  }
}

export function saveVerifiedPhone(phone: string) {
  const normalized = normalizePhoneMY(phone);
  if (!normalized || typeof window === "undefined" || !window.localStorage) {
    return;
  }

  const payload: PhoneVerificationRecord = {
    phone: normalized,
    verified: true,
    verifiedAt: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(PHONE_STORAGE_KEY, normalized);
    window.localStorage.setItem(PHONE_VERIFICATION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore localStorage failures
  }
}

export function clearVerifiedPhone() {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.removeItem(PHONE_STORAGE_KEY);
    window.localStorage.removeItem(PHONE_VERIFICATION_STORAGE_KEY);
  } catch {
    // ignore localStorage failures
  }
}

export function getSavedVerifiedPhone(expectedPhone?: string) {
  const record = readVerificationRecord();
  if (!record) {
    return null;
  }

  const expected = normalizePhoneMY(expectedPhone || "");
  if (expected && record.phone !== expected) {
    return null;
  }

  return record.phone;
}
