export type ProfileUser = {
  id: number;
  username: string;
  display_name?: string;
  has_password?: boolean;
  display?: boolean | null;
  nric_asset_id?: number | null;
  nric_data_id?: number | null;
  email?: string;
  email_verified?: boolean;
  pending_email?: string | null;
  phone?: string;
  name_NRIC?: string;
  NRIC?: string;
  gender?: string;
  parent_1?: string;
  parent_1_phone?: string;
  medical?: string;
  allergy?: string;
  bank_name?: string;
  account_name?: string;
  bank_account?: string;
  tng_number?: string;
  is_member?: boolean | null;
  member_renewals?: MemberRenewalRecord[];
  [key: string]: unknown;
};

export type MemberRenewalRecord = {
  id: number;
  renewal_date?: string | null;
  proof_path?: string | null;
  note?: string | null;
  created_at?: string | null;
};

export type ProfileFootprintEvent = {
  id: number;
  event_name?: string | null;
  datetime?: string | null;
  end_datetime?: string | null;
  location?: string | null;
  type?: string | null;
  event_code?: string | null;
};

export type ProfileFootprintPayment = {
  id: number;
  status?: string | null;
  price?: number | string | null;
  amount?: number | string | null;
  date?: string | null;
  time?: string | null;
  created_at?: string | null;
  counter?: string | null;
};

export type ProfileFormFootprint = {
  kind: "registration_form";
  id: number;
  title?: string | null;
  detail?: string | null;
  expired?: string | null;
  created_at?: string | null;
  footprint_at?: string | null;
  event_count?: number;
  events?: ProfileFootprintEvent[];
  payment_count?: number;
  latest_payment?: ProfileFootprintPayment | null;
  profile_name?: string | null;
  profile_updated_at?: string | null;
};

export type ProfileYouthFootprint = {
  kind: "youth_class";
  id: number;
  submitted_at?: string | null;
  footprint_at?: string | null;
  chinese_name?: string | null;
  english_name?: string | null;
  nric?: string | null;
  age?: number | null;
  category?: string | null;
  address?: string | null;
  gender?: string | null;
  phone?: string | null;
  status?: string | null;
  payment_count?: number;
  latest_payment?: ProfileFootprintPayment | null;
};

export type ProfileFootprintSummary = {
  registration_form_count?: number;
  event_count?: number;
  youth_class_count?: number;
  payment_count?: number;
  total_count?: number;
};

export type ProfileFootprintPayload = {
  member?: {
    id: number;
    nric?: string | null;
    name_nric?: string | null;
    display_name?: string | null;
  } | null;
  summary?: ProfileFootprintSummary;
  registrations?: ProfileFormFootprint[];
  youth_class_registrations?: ProfileYouthFootprint[];
};

export type ProfileFormValues = {
  username: string;
  display_name: string;
  display: string;
  email: string;
  phone: string;
  NRIC: string;
  gender: string;
  parent_1: string;
  parent_1_phone: string;
  medical: string;
  allergy: string;
  bank_name: string;
  account_name: string;
  bank_account: string;
  tng_number: string;
};

export type AppRelease = {
  filename: string;
  size_bytes: number;
  size_label: string;
  download_url: string;
};
