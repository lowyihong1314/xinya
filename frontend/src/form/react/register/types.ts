// 公开报名页用到的类型（对应 window.form_data = form.to_dict_event(is_public=True)）。

export type PublicExtraFieldConfig = {
  id: number;
  label: string;
  field_type: string; // text | textarea | number | date | select | checkbox
  options?: string[] | string | null;
  order?: number | null;
};

export type PublicEventFlow = {
  no?: number | null;
  title?: string | null;
  detail?: string | null;
  minutes?: number | string | null;
};

export type PublicEventUnit = {
  id?: number;
  role?: string | null;
  unit_name?: string | null;
  logo_url?: string | null;
};

export type PublicEvent = {
  event_name?: string | null;
  datetime?: string | null;
  end_datetime?: string | null;
  location?: string | null;
  place_id?: string | null;
  lat?: number | null;
  lng?: number | null;
  target?: string | null;
  purpose?: string | null;
  brochure_path?: string | null;
  brochure_name?: string | null;
  organizing_units?: PublicEventUnit[] | null;
  event_flows?: PublicEventFlow[] | null;
};

export type PublicFee = {
  category?: string;
  amount?: number | string;
  age_range_from?: number | null;
  age_range_to?: number | null;
  description?: string | null;
};

export type PublicForm = {
  id: number;
  title: string;
  detail?: string;
  expired?: string | null;
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
  flexible_time_slot?: boolean;
  field_switches?: Record<string, boolean>;
  fees?: PublicFee[];
  extra_field_configs?: PublicExtraFieldConfig[];
  events?: PublicEvent[];
  registration_closed?: boolean;
  force?: boolean;
  is_full?: boolean;
  max_members?: number | null;
  member_count?: number;
};

export type TimeSlot = { datetime: string; end_datetime: string };

export type Person = {
  name_cn: string;
  name: string; // IC name（英文，大写）
  nric: string;
  phone: string;
  gender: string;
  email: string;
  address: string;
  parent_1: string;
  parent_1_phone: string;
  parent_2: string;
  parent_2_phone: string;
  medical: string;
  allergy: string;
  other_remark: string;
  extraValues: Record<string, unknown>;
  slots: TimeSlot[];
};

export function emptyPerson(): Person {
  return {
    name_cn: "",
    name: "",
    nric: "",
    phone: "",
    gender: "",
    email: "",
    address: "",
    parent_1: "",
    parent_1_phone: "",
    parent_2: "",
    parent_2_phone: "",
    medical: "",
    allergy: "",
    other_remark: "",
    extraValues: {},
    slots: [],
  };
}
