/**
 * 法会（FAHUI）的数据形状。后端 backend/api/fahui/ —— **六个 router、163 条路由**：
 *
 *   /fahui_router/*   ylp/routes.py            订单搜索 / 详情 / 建单 / 版本
 *   /payment/*        common/payment_routes.py 付款审核（lamp + YLP 共用）
 *   /payment/*        ylp/payment_routes.py    订单的收款记录 / 报价单 / 收据
 *   /board_router/*   ylp/board_routes.py      排位板（本次只用它的订单改动日志）
 *   /print_paiwei/*   ylp/print_routes.py      牌位打印（未做）
 *   /diy_paiwei/*     ylp/diy_paiwei.py        自定义牌位（未做）
 *
 * ★ 实测覆盖率：只有 `/fahui_router/versions` 和 `/fahui_router/open_windows` 是
 *   公开接口，用 `node scripts/api-shape.mjs` 实测过（下面标了「实测」）。
 *   其余全部要 fahui_read / account_read / account_edit，匿名打过去只有 401/403，
 *   所以**形状来自后端代码，未实测** —— 逐字对着这几处 return 抄的：
 *     ylp/services.py       serialize_order / serialize_order_detail / search_orders
 *     ylp/payment_services.py  list_order_payment_data
 *     common/payment_review.py serialize_payment
 *     models/fahui.py       FahuiOrderLog.to_dict
 */

// ─────────────────────────── 订单 ───────────────────────────

/**
 * 订单的付款汇总。
 * ★ 后端的 `status` 与 `payment_state` 是**同一个值** —— order_payment_status()
 *   直接 `return order_payment_state(order)`。两个键都留着是历史包袱，读哪个都行。
 * ★ 和单条付款记录的状态（approved/pending/rejected）**不是一套词**，别混用。
 */
export type OrderPaymentStatus = "none" | "pending" | "paid" | "rejected";

/** 单条付款记录的审核状态。 */
export type PaymentRecordStatus = "pending" | "approved" | "rejected";

/** 牌位打印 / 上板进度（services.board_placement_map）。 */
export type BoardStatus = "empty" | "unprinted" | "none" | "partial" | "all";

export interface OrderBoardStatus {
  status: BoardStatus;
  /** 已生成打印页的牌位数。 */
  printed: number;
  /** 已贴上板的牌位数。 */
  placed: number;
  /** 分母：**不含 D 开头的项目**（随缘供斋那类不出牌位，算进去就永远凑不满）。 */
  total: number;
}

/** 列表与详情共有的订单字段（services.serialize_order）。 */
export interface FahuiOrderBase {
  id: number;
  /** 付款汇总。见 OrderPaymentStatus 的注释：和 payment_state 同值。 */
  status: OrderPaymentStatus;
  payment_state: OrderPaymentStatus;
  /**
   * 订单本身的流程状态（orders.status 列），**自由字符串**不是枚举：
   * Draft / confirm / paid / … 都出现过，空值按 Draft 处理（后端排序也这么兜）。
   */
  order_status: string | null;
  /** 联络人。 */
  name: string | null;
  email: string | null;
  /** 功德主。列表主要显示它，没有才退回 name。 */
  customer_name: string | null;
  member_name: string | null;
  user_id: number | null;
  /** 维护人显示名：user_id 对应的用户，旧数据退回 member_name。 */
  maintainer_name: string | null;
  /** ★ 没有查看权限时后端会**打码**成 "XXXX1234"，不是原号码。 */
  phone: string | null;
  /** ★ 格式是 "%y-%m-%d_%H:%M"（两位年 + 下划线），**不是 ISO**。见 format.ts。 */
  created_at: string | null;
  /** 法会版本，形如 "2026_YLP"。 */
  version: string | null;
  total_amount: number;
  /** login/is_logged_in、owner/is_owner 各是一对重复键，后端两个都发。 */
  login: boolean;
  is_logged_in: boolean;
  owner: boolean;
  is_owner: boolean;
  [key: string]: unknown;
}

/**
 * 搜索结果里的一行。
 * ★ **没有 order_items** —— 列表走的是 `serialize_order()` 的默认参数
 *   （include_items=False）。要牌位明细必须进详情。
 * ★ board_status 只有搜索接口会补上，详情接口**没有**这个键。
 */
export interface FahuiOrderRow extends FahuiOrderBase {
  board_status: OrderBoardStatus;
}

/** 牌位项目上的一个表单值。 */
export interface OrderItemFieldValue {
  val: string | null;
  val_id: number;
}

/** 这张打印页贴在哪块板的哪个位置。 */
export interface ItemBoardPlacement {
  board_id: number;
  board_name: string | null;
  /** 线性位号（从 1 起）。 */
  location: number | null;
  board_data_id: number;
  /** 后端已经用板宽换算好了，前端不用再算。板没设宽度时 row/col 是 null。 */
  row: number | null;
  col: number | null;
  /** 形如「第 3 排 第 12 位」。 */
  position_label: string | null;
}

export interface ItemPrintPdf {
  id: number;
  created_at: string | null;
  width: number | null;
  height: number | null;
  boards: Array<{
    board_id: number;
    board_name: string | null;
    location: number | null;
    board_data_id: number;
  }>;
}

export interface ItemLocation {
  print_pdf: ItemPrintPdf;
  pdf_page_data: {
    id: number;
    print_pdf_id: number;
    order_item_id: number;
    order_id: number | null;
  };
  boards: ItemBoardPlacement[];
}

/**
 * 详情里的牌位项目（`full=True` 的那套序列化）。
 *
 * ★★ 本模块最容易踩的一处：`item_form_data` 有**两种形状**，键名却一样。
 *     · full=False（列表 / 导出以外的地方）：`[{id, item_id, field_name, field_value}]`
 *     · full=True （订单详情）：`{ "owner": [{val, val_id}], "deceased": [...] }`
 *     详情页拿到的是**后者**（对象，按 field_name 分组）。
 *     按前者写会编译通过、运行时 `.map is not a function`。
 */
export interface FahuiOrderItem {
  id: number;
  order_id: number;
  /** 牌位类型代码。D 开头的是乐捐/供斋，不出牌位。 */
  code: string | null;
  item_name: string | null;
  /** ★ 后端给的是 **int**（item_price_int 做了截断），不是两位小数。 */
  price: number;
  item_form_data: Record<string, OrderItemFieldValue[]>;
  item_location: ItemLocation[];
  [key: string]: unknown;
}

export interface FahuiOrderDetail extends FahuiOrderBase {
  /** 详情一定带（没有查看权限时后端在更外层就回 403 了）。 */
  order_items: FahuiOrderItem[];
  /** 上一 / 下一张单（按 id 相邻，**不分版本**）。 */
  prev_id: number | null;
  next_id: number | null;
}

/** 搜索接口的 data。 */
export interface OrderSearchResult {
  items: FahuiOrderRow[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    /** 总页数。total 为 0 时后端给 0（不是 1）。 */
    pages: number;
    has_next: boolean;
    has_prev: boolean;
  };
}

export interface OrderSearchResponse {
  status: string;
  data: OrderSearchResult;
}

/** 详情把订单包在 data 里（和搜索的 data 不是一回事）。 */
export interface OrderDetailResponse {
  status: string;
  data: FahuiOrderDetail;
}

/** 可排序的列。后端 services._order_sort_columns 只认这几个，别的值一律按默认排序。 */
export type OrderSortKey =
  | "id"
  | "customer"
  | "phone"
  | "total"
  | "maintainer"
  | "created_at"
  | "order_status"
  | "status";

// ─────────────────────────── 版本 / 开放时间 ───────────────────────────

/**
 * 版本清单。**实测**：`{"status":"success","data":["DELETE","2026_YLP",…]}`。
 * ★ "DELETE" 是**软删除桶**（删单 = 把 version 改成 "DELETE"），不是一届法会。
 */
export interface VersionListResponse {
  status: string;
  data: string[];
}

/** 报名开放时段（每年循环，按 MM-DD 比较，start > end 表示跨年）。 */
export interface OpenWindow {
  id: number;
  fahui_key: string;
  start_md: string;
  end_md: string;
  note: string | null;
}

export interface OpenWindowStatus {
  /** ylp（盂兰盆牌位）/ lamp（点灯）。 */
  fahui_key: string;
  today_md: string;
  is_open: boolean;
  windows: OpenWindow[];
}

/** **实测**：`{status, data:{today_md, items:[{fahui_key, today_md, is_open, windows}]}}`。 */
export interface OpenWindowsResponse {
  status: string;
  data: {
    today_md: string;
    items: OpenWindowStatus[];
  };
}

// ─────────────────────────── 收款 ───────────────────────────

/**
 * 订单详情页的收款记录（ylp payment router 的 /payment/get_payment_data/{orderId}）。
 * 字段比审核列表少，是**另一套**序列化，别拿 ReviewPayment 的类型套。
 */
export interface OrderPayment {
  id: number;
  /** 合并付款时是 null —— 这笔钱不属于任何单张订单。 */
  order_id: number | null;
  /** 合并付款实际覆盖了哪几张单。非合并付款是空数组。 */
  grouped_order_ids: number[];
  total_price: number | null;
  payment_mode: string | null;
  /** 凭证文件的存储路径。有值才说明上传过凭证。 */
  document: string | null;
  status: PaymentRecordStatus;
  is_approved: boolean;
  /** ISO 字符串（和订单的 created_at 格式**不一样**）。 */
  created_at: string | null;
  submitter_id: number | null;
  /** 审核人显示名。 */
  valid_by: string | null;
  valid_at: string | null;
  login: boolean;
  is_logged_in: boolean;
}

export interface OrderPaymentListResponse {
  success: boolean;
  data: OrderPayment[];
}

/** 审核列表里附带的订单摘要（common/payment_review.serialize_order_summary）。 */
export interface ReviewPaymentOrder {
  id: number;
  customer_name: string | null;
  name: string | null;
  phone: string | null;
  status: string | null;
  created_at: string | null;
  version: string | null;
}

/** 点灯登记（type === "lamp" 的付款才有）。 */
export interface LampRegistration {
  id: number;
  devotee_name: string | null;
  address: string | null;
  phone: string | null;
  /** ★ 字符串（Decimal 直接 str()），不是数字。 */
  total_amount: string;
  status: string | null;
  created_at: string | null;
  lamps: Array<{ lamp_type: string | null; amount: string; note: string | null }>;
}

/**
 * 审核列表里的一条付款（common/payment_review.serialize_payment）。
 * ★ 有三对重复键，后端同时发两份：id/payment_id、amount/total_price、
 *   method/payment_mode、document/doc_path。读哪个都行，别以为是不同的东西。
 */
export interface ReviewPayment {
  id: number;
  payment_id: number;
  /** "ylp"（牌位）/ "lamp"（点灯）。缺值时后端按 ylp 算。 */
  type: string;
  order_id: number | null;
  amount: number;
  total_price: number;
  method: string | null;
  payment_mode: string | null;
  payer_name: string | null;
  phone: string | null;
  paid_at: string | null;
  /** ISO 字符串。 */
  created_at: string | null;
  submitter_id: number | null;
  valid_by: string | null;
  valid_at: string | null;
  note: string | null;
  document: string | null;
  doc_path: string | null;
  status: PaymentRecordStatus;
  is_approved: boolean;
  /** 合并付款（order_id 为 null）时后端不会带这个键。 */
  order?: ReviewPaymentOrder | null;
  /** 只有点灯付款带。 */
  registrations?: LampRegistration[];
}

/** ★ 信封同时有 success（布尔）和 status（字符串），是历史遗留的重复，后端故意保留。 */
export interface ReviewPaymentListResponse {
  success: boolean;
  status: string;
  data: ReviewPayment[];
}

/** 审核动作的响应：改完的那条付款挂在 **payment** 键上（不是 data）。 */
export interface ReviewPaymentMutationResponse {
  success: boolean;
  status: string;
  payment: ReviewPayment;
}

// ─────────────────────────── 订单改动日志 ───────────────────────────

/**
 * 订单改动记录（models/fahui.py FahuiOrderLog.to_dict）。
 * 公开页访客没有账号，所以 user_id 与 phone 是二选一；`actor` 是后端算好的显示名。
 */
export interface OrderLog {
  id: number;
  order_id: number;
  /** 牌位项目级别的改动才有。 */
  item_id: number | null;
  /** order / item / customer / status / payment */
  target: string;
  /** create / update / delete / restore */
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  /** 给人看的一句话，优先显示它。 */
  summary: string | null;
  user_id: number | null;
  user_name: string | null;
  phone: string | null;
  actor: string;
  /** "YYYY-MM-DD HH:MM:SS"（又是第三种时间格式）。 */
  created_at: string | null;
}

export interface OrderLogListResponse {
  status: string;
  data: OrderLog[];
}
