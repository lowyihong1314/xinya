export type FormFee = {
  id: number;
  category: string;
  amount: number | string;
  age_range_from?: number | string | null;
  age_range_to?: number | string | null;
  description?: string | null;
  image_path?: string | null;
};

export type ExtraFieldConfig = {
  id: number;
  label: string;
  field_type: string;
  options?: string[] | null;
  order?: number | null;
};

export type FormEvent = {
  id: number;
  event_name?: string;
  datetime?: string;
  end_datetime?: string;
  location?: string;
  type?: string;
  target?: string;
  purpose?: string;
  event_image?: { id: number } | null;
};

export type FormMemberExtraField = {
  id?: number;
  field_config_id: number;
  field_type?: string | null;
  label?: string | null;
  field_value?: string | number | boolean | null;
  regis_member_data_id?: number;
  created_at?: string | null;
};

export type FormPayment = {
  id: number;
  regis_form_id: number;
  nric_asset_id?: number;
  regis_member_id?: number;
  nric: string;
  nric_snapshot?: string | null;
  name: string;
  phone: string;
  payment_mode: string;
  price: number;
  date?: string | null;
  time?: string | null;
  status?: string | null;
  counter?: string | null;
  proof_image_path?: string | null;
  proof_image_url?: string | null;
};

export type FormFieldSwitches = {
  email?: boolean;
  parental_form?: boolean;
  parent_1?: boolean;
  parent_2?: boolean;
  parent_1_phone?: boolean;
  address?: boolean;
  parent_2_phone?: boolean;
  medical?: boolean;
  allergy?: boolean;
  other_remark?: boolean;
};

export type FormMemberTimeSlot = {
  datetime?: string | null;
  end_datetime?: string | null;
};

export type FormMember = {
  id: number;
  name_cn?: string;
  name?: string;
  phone?: string;
  gender?: string;
  email?: string;
  address?: string;
  other_remark?: string;
  nric?: string;
  parent_1?: string;
  parent_2?: string;
  parent_1_phone?: string;
  parent_2_phone?: string;
  medical?: string;
  allergy?: string;
  available_time_slot_json?: FormMemberTimeSlot[] | null;
  parental_data?: unknown;
  extra_fields?: FormMemberExtraField[];
  field_values?: FormMemberExtraField[];
  payments?: FormPayment[];
  [key: string]: unknown;
};

export type FormRecord = {
  id: number;
  title: string;
  detail?: string;
  expired?: string;
  created_at?: string;
  member_count?: number;
  fees?: FormFee[];
  payments?: FormPayment[];
  extra_field_configs?: ExtraFieldConfig[];
  members?: FormMember[];
  events?: FormEvent[];
  event?: FormEvent | null;
  event_id?: number | null;
  field_switches?: FormFieldSwitches;
  email?: boolean;
  parental_form?: boolean;
  parent_1?: boolean;
  parent_2?: boolean;
  parent_1_phone?: boolean;
  parent_2_phone?: boolean;
  address?: boolean;
  medical?: boolean;
  allergy?: boolean;
  other_remark?: boolean;
};

export type FormDetailResponse = {
  form?: FormRecord;
};

export type FormListResponse = {
  status?: string;
  forms?: FormRecord[];
};

export type FormCreatePayload = {
  title: string;
  detail: string;
  expired: string;
  field_switches?: FormFieldSwitches;
  email?: boolean;
  parental_form?: boolean;
  parent_1?: boolean;
  parent_2?: boolean;
  parent_1_phone?: boolean;
  parent_2_phone?: boolean;
  address?: boolean;
  medical?: boolean;
  allergy?: boolean;
  other_remark?: boolean;
  extra_fields_config: Array<{
    label: string;
    field_type: string;
    options?: string[] | null;
    order?: number | null;
  }>;
};
