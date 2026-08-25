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
  success?: boolean;
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

export type YlpPaiweiTablet = {
  order_id: number;
  item_id: number | null;
  code: string;
  width: number;
  height: number;
  /** data:image/jpeg;base64,... —— 后端从牌位 PDF 里裁出来的单张牌位 */
  image: string;
};

export type YlpPaiweiPreviewResponse = {
  status?: string;
  message?: string;
  data?: {
    tablets: YlpPaiweiTablet[];
    truncated?: boolean;
  };
};

export type YlpOrderSummary = {
  id: number;
  status?: string | null;
  payment_state?: string | null;
  order_status?: string | null;
  name?: string | null;
  email?: string | null;
  customer_name?: string | null;
  member_name?: string | null;
  user_id?: number | null;
  maintainer_name?: string | null;
  phone?: string | null;
  created_at?: string | null;
  version?: string | null;
  total_amount?: number | null;
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

// 原始文档：手写单据原图存档（DATA_ROOT/fahui_raw_img）
export type FahuiRawDocOrderLink = {
  order_id: number;
  phone?: string | null;
  item_count?: number;
  order_total?: number;
  match_by?: string | null;
  confidence?: "high" | "medium" | "low" | "manual" | string | null;
  note?: string | null;
  version?: string | null;
  customer_name?: string | null;
  status?: string | null;
};

export type FahuiRawDocFlag = {
  id: number;
  seq: number;
  text: string;
  resolved: boolean;
  resolved_at?: string | null;
  resolved_by?: string | null;
};

export type FahuiRawDoc = {
  id?: number;
  filename: string;
  size: number;
  date?: string;
  source?: string;
  extract?: string;
  customer?: string;
  phone?: string;
  declared_total?: string;
  review_flags?: string;
  plan?: string;
  duplicate_of?: string;
  orders?: FahuiRawDocOrderLink[];
  flags?: FahuiRawDocFlag[];
  flags_open?: number;
  flags_total?: number;
};

export type FahuiRawDocListResponse = {
  status?: string;
  message?: string;
  error?: string;
  data?: { items: FahuiRawDoc[]; total: number; root?: string; ready?: boolean; source?: string };
};

// 版本 ⇄ 活动绑定：绑定后该版本的订单收入会进活动预算
export type YlpVersionEventBinding = {
  id: number;
  workspace: string;
  version: string;
  event_id: number;
  event_name?: string | null;
  event_datetime?: string | null;
  created_at?: string | null;
};

export type YlpVersionEventResponse = {
  status?: string;
  message?: string;
  error?: string;
  data?: YlpVersionEventBinding | null;
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

export type YlpPaymentChannel = {
  id: number;
  version: string;
  channel_type: "qr" | "bank";
  label?: string | null;
  qr_image_path?: string | null;
  bank_name?: string | null;
  bank_account_no?: string | null;
  bank_account_name?: string | null;
  note?: string | null;
  sort_order?: number;
  is_active?: boolean;
  created_at?: string | null;
};

export type YlpPaymentChannelListResponse = {
  status?: string;
  message?: string;
  data?: YlpPaymentChannel[];
};

export type YlpPaymentChannelMutationResponse = {
  status?: string;
  message?: string;
  data?: YlpPaymentChannel;
};

export type YlpRelationOption = {
  id: number;
  label: string;
  sort_order?: number;
  is_active?: boolean;
};

export type YlpRelationOptionListResponse = {
  status?: string;
  message?: string;
  data?: YlpRelationOption[];
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
