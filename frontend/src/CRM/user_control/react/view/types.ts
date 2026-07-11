export type Toast = { type: "success" | "error"; text: string } | null;

export type CreateUserPayload = {
  username: string;
  email: string;
  phone?: string;
  password: string;
};

export type UserEditorPayload = {
  username: string;
  display_name: string;
  email: string;
  phone: string;
  name_NRIC: string;
  display: boolean;
  is_member: boolean;
  NRIC: string;
  gender: string;
  parent_1: string;
  parent_1_phone: string;
  medical: string;
  allergy: string;
};

export type MemberRenewalPayload = {
  renewal_date: string;
  note?: string;
  proof?: File | null;
};
