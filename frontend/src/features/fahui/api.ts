/**
 * 法会。后端 backend/api/fahui/ —— **六个 router 分挂五个前缀**，这里是前端
 * 唯一知道这些路径的地方。哪条属于哪个 router 很重要，因为
 * `/payment` 下**有两个 router**（common 与 ylp），职责完全不同：
 *
 *   /fahui_router/*  ylp/routes.py             订单搜索、订单详情、版本、开放时间
 *   /payment/*       common/payment_routes.py  ← 付款**审核**（lamp + YLP 共用一套）
 *   /payment/*       ylp/payment_routes.py     ← **某张订单**的收款记录 / 报价单 / 收据
 *   /board_router/*  ylp/board_routes.py       排位板（这里只用它的订单改动日志）
 *
 * 两边今天没有一条路径重叠（common 全在 /payments /review /get_payment_* 下，
 * ylp 全在 /orders /get_payment_data /calculate_amount /download_* 下），
 * 撞车时 common 胜出 —— 见 backend/api/fahui/__init__.py。
 *
 * ⚠️ 未做的三个 router（print_paiwei / board_router 的板面操作 / diy_paiwei）
 *    是画布与 PDF 生成，不在本次范围内。
 */
import { http } from "@/shared/api/client";
import { ApiError } from "@/shared/api/errors";
import { API_ROOT } from "@/shared/config/env";

import type {
  FahuiOrderDetail,
  OpenWindowsResponse,
  OrderDetailResponse,
  OrderLog,
  OrderLogListResponse,
  OrderPayment,
  OrderPaymentListResponse,
  OrderSearchResponse,
  OrderSearchResult,
  OrderSortKey,
  ReviewPayment,
  ReviewPaymentListResponse,
  ReviewPaymentMutationResponse,
  VersionListResponse,
} from "./types";

export const fahuiKeys = {
  all: ["fahui"] as const,
  versions: () => [...fahuiKeys.all, "versions"] as const,
  openWindows: () => [...fahuiKeys.all, "open-windows"] as const,
  orders: (params: OrderSearchParams) => [...fahuiKeys.all, "orders", params] as const,
  order: (id: number) => [...fahuiKeys.all, "order", id] as const,
  orderPayments: (id: number) => [...fahuiKeys.all, "order", id, "payments"] as const,
  orderLogs: (id: number) => [...fahuiKeys.all, "order", id, "logs"] as const,
  reviewPayments: () => [...fahuiKeys.all, "review-payments"] as const,
};

// ─────────────────── /fahui_router（订单主体）───────────────────

export interface OrderSearchParams {
  /** 必填。缺了或空串后端一律 400「version is required」。 */
  version: string;
  search?: string;
  page?: number;
  perPage?: number;
  sort?: OrderSortKey;
  direction?: "asc" | "desc";
}

/**
 * 订单搜索（也是列表 —— 不传关键词就是整个版本）。
 *
 * ★ 查询串里的排序方向叫 **dir**，不是 direction。后端用 alias 保住了这个名字
 *   （函数里不敢叫 dir，会遮住内建函数），前端得按线上的名字发。
 * ★ 搜索值是 4 位以内纯数字时后端**按订单号精确查**，不走模糊匹配 ——
 *   否则搜 "674" 会把电话含 674 的单全捞出来。这是后端行为，前端不用管。
 */
export const searchOrders = async (params: OrderSearchParams): Promise<OrderSearchResult> =>
  (
    await http.get<OrderSearchResponse>("/fahui_router/orders/search", {
      query: {
        version: params.version,
        value: params.search || undefined,
        page: params.page,
        per_page: params.perPage,
        sort: params.sort,
        dir: params.direction,
      },
    })
  ).data;

export const fetchOrder = async (orderId: number): Promise<FahuiOrderDetail> =>
  (await http.get<OrderDetailResponse>(`/fahui_router/orders/${orderId}`)).data;

/** 版本清单。含 "DELETE" 这个软删除桶，页面要自己过滤/标注。 */
export const fetchVersions = async (): Promise<string[]> =>
  (await http.get<VersionListResponse>("/fahui_router/versions")).data;

/** 报名开放状态（公开接口，一次拿 ylp + lamp 两套）。 */
export const fetchOpenWindows = async (): Promise<OpenWindowsResponse["data"]> =>
  (await http.get<OpenWindowsResponse>("/fahui_router/open_windows")).data;

// ─────────────────── /payment（ylp router：某张订单的收款）───────────────────

/**
 * 一张订单的收款记录。
 *
 * ★★ 没有任何付款时后端回的是 **404 +「该订单没有支付记录」**，不是空数组。
 *    不在这里拦下来的话，一张还没人付款的订单在详情页会整片变成错误态 ——
 *    而「还没付款」本来就是最常见的状态。
 *    只吞 404：403（没权限）、500 要照常抛出去，那才是真的出问题了。
 */
export const fetchOrderPayments = async (orderId: number): Promise<OrderPayment[]> => {
  try {
    const res = await http.get<OrderPaymentListResponse>(`/payment/get_payment_data/${orderId}`);
    return res.data ?? [];
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
};

/**
 * 报价单 PDF / 收据 PNG 的直链。
 *
 * ★ 不走 http 客户端：它会把响应当文本读进内存，而这两条返回的是二进制附件。
 *   直接交给 <a href download> 让浏览器自己下载。
 * ★ 必须用 API_ROOT（origin + BASE_PATH）：裸路径在 APK 里会去找
 *   capacitor://localhost/payment/…，永远 404。
 * ⚠️ 直链带的是 Cookie 凭证，APK（Bearer）下拿不到 —— 和 music 的音频直链
 *   是同一个已知限制，网页版可用。
 */
export const orderQuotationUrl = (orderId: number) =>
  `${API_ROOT}/payment/orders/${orderId}/quotation`;

/** 收据图。后端会先校验「已有审核通过的付款」，否则 403。 */
export const orderReceiptImageUrl = (orderId: number) =>
  `${API_ROOT}/payment/orders/${orderId}/receipt-image`;

// ─────────────────── /payment（common router：付款审核）───────────────────

/**
 * 待审核清单：**lamp + YLP 两种付款混在一起**（按 type 区分），
 * 而且**不分页、不过滤** —— 后端一次性把全部付款按时间倒序发下来。
 * 状态筛选和搜索都在前端做。
 */
export const fetchReviewPayments = async (): Promise<ReviewPayment[]> =>
  (await http.get<ReviewPaymentListResponse>("/payment/review")).data;

export const approvePayment = (paymentId: number) =>
  http.post<ReviewPaymentMutationResponse>(`/payment/review/${paymentId}/approve`);

/** 退回待审核。★ 会**联动订单状态**重算。 */
export const revokePayment = (paymentId: number) =>
  http.post<ReviewPaymentMutationResponse>(`/payment/review/${paymentId}/revoke`);

/**
 * 撤回：把这条付款标成「已拒绝」，但**订单状态保持原样**。
 * ★ 和 revoke 看着像同一件事，其实不是（后端 sync_owner_status=False），别合并。
 */
export const withdrawPayment = (paymentId: number) =>
  http.post<ReviewPaymentMutationResponse>(`/payment/review/${paymentId}/withdraw`);

/** 删除付款记录，**连凭证文件一起删**，不可撤销。 */
export const deletePayment = (paymentId: number) =>
  http.delete<{ success: boolean; status: string }>(`/payment/review/${paymentId}`);

/** 付款凭证（图片或 PDF）。直链，注意事项同 orderQuotationUrl。 */
export const paymentDocumentUrl = (paymentId: number) =>
  `${API_ROOT}/payment/payments/${paymentId}/document`;

// ─────────────────── /board_router（只取订单改动日志）───────────────────

/**
 * 订单改动记录。挂在 board_router 下（排位板那套）是历史原因，
 * 但它是订单级别的只读数据，权限和看订单详情一致，所以详情页直接用。
 * 后端最多给 200 条。
 */
export const fetchOrderLogs = async (orderId: number): Promise<OrderLog[]> =>
  (await http.get<OrderLogListResponse>(`/board_router/orders/${orderId}/logs`)).data;
