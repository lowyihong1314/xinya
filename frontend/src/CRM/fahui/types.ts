export type LampItem = {
  lamp_type: string;
  amount?: number | string | null;
};

export type RegistrationRecord = {
  id?: number;
  devotee_name?: string | null;
  phone?: string | null;
  address?: string | null;
  total_amount?: number | string | null;
  status?: string | null;
  created_at?: string | null;
  lamps?: LampItem[] | null;
};

export type PaymentType = "lamp" | "ylp";

export type PaymentOrderSummary = {
  id?: number | null;
  customer_name?: string | null;
  name?: string | null;
  phone?: string | null;
  status?: string | null;
  created_at?: string | null;
  version?: string | null;
};

export type PaymentRecord = {
  id?: number;
  payment_id: number;
  type?: PaymentType;
  order_id?: number | null;
  payer_name?: string | null;
  phone?: string | null;
  amount?: number | string | null;
  total_price?: number | string | null;
  method?: string | null;
  payment_mode?: string | null;
  paid_at?: string | null;
  created_at?: string | null;
  submitter_id?: number | null;
  valid_by?: string | null;
  valid_at?: string | null;
  note?: string | null;
  document?: string | null;
  doc_path?: string | null;
  is_approved?: boolean;
  status?: string | null;
  registrations?: RegistrationRecord[] | null;
  order?: PaymentOrderSummary | null;
};

export type PaymentListResponse = {
  data?: PaymentRecord[];
  message?: string;
  status?: string;
  error?: string;
};

export type PaymentActionResponse = {
  payment?: PaymentRecord;
  message?: string;
  status?: string;
  error?: string;
};

export type YlpPagination = {
  page?: number;
  per_page?: number;
  total?: number;
  pages?: number;
  has_next?: boolean;
  has_prev?: boolean;
};

export type YlpOrderSummary = {
  id: number;
  status?: string | null;
  name?: string | null;
  email?: string | null;
  customer_name?: string | null;
  member_name?: string | null;
  phone?: string | null;
  created_at?: string | null;
  version?: string | null;
  login?: boolean;
  owner?: boolean;
};

export type YlpOrderListResponse = {
  status?: string;
  message?: string;
  error?: string;
  data?: {
    items?: YlpOrderSummary[];
    pagination?: YlpPagination;
  };
};

export type YlpOrderItemField = {
  val?: string | null;
  val_id?: number | null;
};

export type YlpOrderBoardLocation = {
  board_id?: number | null;
  board_name?: string | null;
  location?: number | null;
  board_data_id?: number | null;
};

export type YlpOrderItemLocation = {
  print_pdf?: {
    id?: number | null;
    created_at?: string | null;
    width?: number | null;
    height?: number | null;
  } | null;
  pdf_page_data?: {
    id?: number | null;
    print_pdf_id?: number | null;
    order_item_id?: number | null;
    order_id?: number | null;
  } | null;
  boards?: YlpOrderBoardLocation[] | null;
};

export type YlpOrderItem = {
  id: number;
  order_id?: number | null;
  code?: string | null;
  item_name?: string | null;
  price?: number | string | null;
  item_form_data?: Record<string, YlpOrderItemField[]> | null;
  item_location?: YlpOrderItemLocation[] | null;
};

export type YlpOrderDetail = YlpOrderSummary & {
  prev_id?: number | null;
  next_id?: number | null;
  order_items?: YlpOrderItem[] | null;
};

export type YlpOrderDetailResponse = {
  status?: string;
  message?: string;
  error?: string;
  data?: YlpOrderDetail;
};

export type YlpVersionResponse = {
  status?: string;
  message?: string;
  error?: string;
  data?: string[];
};

export type YlpOrdersByPhoneResponse = {
  status?: string;
  message?: string;
  error?: string;
  data?: {
    phone?: string;
    items?: YlpOrderSummary[];
  };
};

export type YlpOrderCreateResponse = {
  success?: boolean;
  message?: string;
  duplicated?: boolean;
  order?: YlpOrderSummary | null;
};

export type YlpOrderItemMutationResponse = {
  success?: boolean;
  message?: string;
  item_id?: number | null;
};

export type YlpPaymentRecord = {
  id: number;
  order_id?: number | null;
  total_price?: number | null;
  payment_mode?: string | null;
  document?: string | null;
  status?: string | null;
  is_approved?: boolean;
  created_at?: string | null;
  valid_by?: string | null;
  valid_at?: string | null;
  login?: boolean;
};
