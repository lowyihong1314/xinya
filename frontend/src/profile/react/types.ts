export type ProfileUser = {
  id: number;
  username: string;
  email?: string;
  phone?: string;
  name_NRIC?: string;
  NRIC?: string;
  gender?: string;
  parent_1?: string;
  parent_1_phone?: string;
  medical?: string;
  allergy?: string;
  [key: string]: unknown;
};

export type ProfileFormValues = {
  email: string;
  phone: string;
  name_NRIC: string;
  NRIC: string;
  gender: string;
  parent_1: string;
  parent_1_phone: string;
  medical: string;
  allergy: string;
};
