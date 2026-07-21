export type LampItem = {
  lamp_type: string;
  amount: number | string;
  note?: string | null;
};

export type LampRegistrationRecord = {
  id: number;
  devotee_name: string;
  address?: string | null;
  phone?: string | null;
  total_amount: number | string;
  status?: string | null;
  serial_no?: string | null;
  receipt_no?: string | null;
  payment_date?: string | null;
  cashier_name?: string | null;
  created_at?: string | null;
  lamps?: LampItem[];
};

export type LampListResponse = {
  status?: string;
  message?: string;
  data?: LampRegistrationRecord[];
};

export const LAMP_STATUS_OPTIONS = ["draft", "confirm"] as const;
