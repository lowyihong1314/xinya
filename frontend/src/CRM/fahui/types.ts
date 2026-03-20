export type LampItem = {
  lamp_type: string;
  amount?: number | string | null;
};

export type RegistrationRecord = {
  devotee_name?: string | null;
  phone?: string | null;
  address?: string | null;
  total_amount?: number | string | null;
  lamps?: LampItem[] | null;
};

export type PaymentRecord = {
  payment_id: number;
  payer_name?: string | null;
  phone?: string | null;
  amount?: number | string | null;
  method?: string | null;
  paid_at?: string | null;
  created_at?: string | null;
  submitter_id?: number | null;
  registrations?: RegistrationRecord[] | null;
};

export type PaymentListResponse = {
  data?: PaymentRecord[];
  message?: string;
  status?: string;
  error?: string;
};
