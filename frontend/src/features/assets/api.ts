/**
 * 资产 / 库存。后端 backend/api/asset/router.py（挂载前缀 /asset，19 条路径 / 26 个方法）。
 *
 * ★ 本模块**每一条**接口的成功响应都是 `{"status":"success", "message"?, "data"?}`，
 *   业务数据在 data 里。外层统一在这里剥掉，页面拿到的就是数据本身 ——
 *   否则每个调用点都要写一次 `.data`，漏写一处就是编译通过、运行时 undefined。
 *   ⚠️ 三条 **delete 接口只回 message，没有 data 键**（后端故意的，见 router.py），
 *      所以它们不走 unwrap，返回类型是 `void`。
 *
 * ★ 失败一律是 `{"status":"error","message":"<中文句子>"}` + 400/401/403/404，
 *   由 http 客户端抛成 ApiError。**中文文案以后端为唯一来源**，页面直接 toast 出来，
 *   不要在前端再写一套校验提示（比如「仓库名称已存在」「只有 draft 单据才能编辑」）。
 *
 * ⚠️ 前端页面地址用 /assets（复数）不用 /asset：后端占着 /asset 开头的 19 条路由，
 *    同名的话那条前端路由永远到不了浏览器。已核对后端 546 条路由里没有 /assets 开头的。
 */
import { http } from "@/shared/api/client";
import { upload } from "@/shared/api/upload";
import { tokenStore } from "@/shared/auth/tokenStore";
import { API_ROOT } from "@/shared/config/env";

import type {
  AssetDashboardPayload,
  AssetDocumentsPayload,
  AssetInventoryPayload,
  AssetInventoryRow,
  AssetItem,
  AssetMasterDataPayload,
  AssetMovementsPayload,
  AssetPartner,
  AssetStockDocument,
  AssetSubItem,
  AssetWarehouse,
  DocumentType,
  PartnerType,
} from "./types";

/** 后端的成功信封。 */
interface AssetEnvelope<T> {
  status: string;
  message?: string;
  data: T;
}

const unwrap = async <T>(promise: Promise<AssetEnvelope<T>>): Promise<T> => (await promise).data;

/** 删除类接口的信封：**没有 data 键**，调用方也不该去读。 */
const discard = async (promise: Promise<unknown>): Promise<void> => {
  await promise;
};

export const assetKeys = {
  all: ["assets"] as const,
  dashboard: () => [...assetKeys.all, "dashboard"] as const,
  masterData: () => [...assetKeys.all, "master-data"] as const,
  inventory: () => [...assetKeys.all, "inventory"] as const,
  documents: () => [...assetKeys.all, "documents"] as const,
  movements: () => [...assetKeys.all, "movements"] as const,
  partners: () => [...assetKeys.all, "partners"] as const,
};

// --------------------------------------------------------------------------- //
// 只读
// --------------------------------------------------------------------------- //

/**
 * 看板：metrics + 仓库 + 往来单位 + 物品 + 库存 + 最近 30 张单据（带明细和流水）。
 *
 * /assets 整页就靠这一条。它确实比 /asset/inventory + /asset/master-data 重
 * （多了 30 张单据的明细），但那两条加起来要两个请求、metrics 还得自己算 ——
 * 而「概览」那一屏本来就要显示最近单据和库存预警，这些单据不是白拿的。
 */
export const fetchAssetDashboard = () =>
  unwrap(http.get<AssetEnvelope<AssetDashboardPayload>>("/asset/dashboard"));

/** 单据页用：单据 + 仓库 + 物品（后两者是建单表单的下拉数据）。 */
export const fetchStockDocuments = () =>
  unwrap(http.get<AssetEnvelope<AssetDocumentsPayload>>("/asset/stock-documents"));

/**
 * 流水。返回的还是**单据**，流水挂在 `documents[].movements` 里 —— 不是一张平的流水表，
 * 要平铺得自己 flatMap。同样只有最近 30 张单据。
 */
export const fetchAssetMovements = () =>
  unwrap(http.get<AssetEnvelope<AssetMovementsPayload>>("/asset/movements"));

/**
 * 往来单位的**裸数组**（不像别的只读接口那样包一层对象）。
 * 单据页要它：/asset/stock-documents 给了 warehouses 和 items，**唯独没给 partners**。
 */
export const fetchAssetPartners = () =>
  unwrap(http.get<AssetEnvelope<AssetPartner[]>>("/asset/partners"));

/**
 * 下面两条本模块的页面**不调用** —— 看板那一条已经把它们的内容全带上了。
 * 但它们是 /asset 的路由，按「只有 api.ts 知道接口路径」的约定放在这里：
 * 将来别的模块要一份仓库 / 物品清单时从这里导入，不要在那边重新写一遍路径。
 */
export const fetchAssetMasterData = () =>
  unwrap(http.get<AssetEnvelope<AssetMasterDataPayload>>("/asset/master-data"));

export const fetchAssetInventory = () =>
  unwrap(http.get<AssetEnvelope<AssetInventoryPayload>>("/asset/inventory"));

// --------------------------------------------------------------------------- //
// 仓库
// --------------------------------------------------------------------------- //

export interface WarehouseInput {
  name: string;
  /** 留空时后端自动生成 `WH-0001`；**改的时候留空 = 保留原编号**，不是清空。 */
  code: string;
  location: string | null;
  remark: string | null;
  /** ⚠️ 后端无条件按这个值覆盖，**不传就等于清空负责人**。表单必须带上原值。 */
  manager_user_id: number | null;
}

export const createWarehouse = (input: WarehouseInput) =>
  unwrap(http.post<AssetEnvelope<AssetWarehouse>>("/asset/warehouses", input));

export const updateWarehouse = (id: number, input: WarehouseInput) =>
  unwrap(http.patch<AssetEnvelope<AssetWarehouse>>(`/asset/warehouses/${id}`, input));

/** 有库存 / 有流水 / 被单据引用的仓库删不掉，后端三句不同的中文文案，原样弹给用户。 */
export const deleteWarehouse = (id: number) => discard(http.delete(`/asset/warehouses/${id}`));

// --------------------------------------------------------------------------- //
// 往来单位
// --------------------------------------------------------------------------- //

export interface PartnerInput {
  name: string;
  /** ★ 和仓库/物品不一样：往来单位的编号是**必填**的（后端不会自动生成）。会被转成大写。 */
  code: string;
  partner_type: PartnerType;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  status: string;
  remark: string | null;
}

export const createPartner = (input: PartnerInput) =>
  unwrap(http.post<AssetEnvelope<AssetPartner>>("/asset/partners", input));

export const updatePartner = (id: number, input: PartnerInput) =>
  unwrap(http.patch<AssetEnvelope<AssetPartner>>(`/asset/partners/${id}`, input));

export const deletePartner = (id: number) => discard(http.delete(`/asset/partners/${id}`));

// --------------------------------------------------------------------------- //
// 物品 / 子物品
// --------------------------------------------------------------------------- //

export interface ItemInput {
  name: string;
  /** 留空时后端自动生成 `ITM-0001`；改的时候留空 = 保留原编码。 */
  code: string;
  category: string | null;
  /** 留空时后端补 "件"。 */
  unit: string;
  status: string;
  remark: string | null;
}

export const createItem = (input: ItemInput) =>
  unwrap(http.post<AssetEnvelope<AssetItem>>("/asset/items", input));

export const updateItem = (id: number, input: ItemInput) =>
  unwrap(http.patch<AssetEnvelope<AssetItem>>(`/asset/items/${id}`, input));

/** 还有子物品的物品删不掉（「请先删除这个 Item 下的全部子 Item」）。 */
export const deleteItem = (id: number) => discard(http.delete(`/asset/items/${id}`));

export interface SubItemInput {
  name: string;
  sku: string | null;
  size: string | null;
  color: string | null;
  barcode: string | null;
  status: string;
  remark: string | null;
  /** 只有改的时候有意义：换一个所属物品。不传 = 留在原来的物品下。 */
  item_id?: number;
}

export const createSubItem = (itemId: number, input: SubItemInput) =>
  unwrap(http.post<AssetEnvelope<AssetSubItem>>(`/asset/items/${itemId}/sub-items`, input));

export const updateSubItem = (id: number, input: SubItemInput) =>
  unwrap(http.patch<AssetEnvelope<AssetSubItem>>(`/asset/sub-items/${id}`, input));

/** 有库存 / 有流水 / 出现在单据里的子物品删不掉。 */
export const deleteSubItem = (id: number) => discard(http.delete(`/asset/sub-items/${id}`));

// --------------------------------------------------------------------------- //
// 库存预警线
// --------------------------------------------------------------------------- //

/**
 * 改最低库存（预警线）。**这是整个模块唯一能直接写 inventory 行的接口**，
 * 而且它改的也不是库存数量 —— 数量只能由单据确认产生的流水来动。
 */
export const updateInventoryThreshold = (inventoryId: number, minQuantity: number) =>
  unwrap(
    http.patch<AssetEnvelope<AssetInventoryRow>>(`/asset/inventory/${inventoryId}/threshold`, {
      min_quantity: minQuantity,
    }),
  );

// --------------------------------------------------------------------------- //
// 出入库单据
// --------------------------------------------------------------------------- //

export interface StockDocumentLineInput {
  /** null 时后端回「第 N 行缺少子 item」，这句话直接给用户看。 */
  sub_item_id: number | null;
  /** 盘点调整允许负数（盘亏），其余类型必须 > 0。两种都由后端判并给文案。 */
  quantity: string;
  /** 空串 = 没填（后端 `value in (None, "")` 时当 null），不是 0。所以用字符串发。 */
  unit_cost: string;
  unit_price: string;
  /** 留空时后端按 单价×数量（没有单价就成本价×数量）自己算。 */
  line_amount: string;
  remark: string | null;
}

/**
 * 建单 / 改单的请求体。
 *
 * ★ **这个对象是「整份覆盖」，不是打补丁。** 后端 `_validate_document_payload`
 *   对下面每个键都无条件取值往单据上写，所以**少传一个键就等于把那个字段清空**。
 *   表单里没有控件的字段（event_id / invoice_type / reference_*）必须把单据上的
 *   原值原样带回来，这就是它们出现在这个接口里的全部原因。
 *
 * ★ 唯一的例外是 `invoice_file_path`：后端判的是「**键在不在**」而不是值空不空，
 *   所以这里**根本没有这个字段** —— 不传，发票文件才能保住。
 *   （传 null 会把已上传的发票从单据上摘掉。）
 */
export interface StockDocumentInput {
  document_type: DocumentType;
  source_warehouse_id: number | null;
  target_warehouse_id: number | null;
  /** 不传时后端按 原单据申请人 → 当前登录用户 兜底，所以这个字段清不掉。 */
  requester_user_id: number | null;
  handler_user_id: number | null;
  taken_by_user_id: number | null;
  /** 领用人不是系统用户时用它。填了就以它为准（冗余存进单据）。 */
  taken_by_name: string | null;
  /** 由单据类型推出来的去向大类，见 format.ts。 */
  destination_type: string | null;
  destination_text: string | null;
  counterparty_id: number | null;
  /** 留空时后端取所选往来单位的名字。 */
  counterparty_name: string | null;
  event_id: number | null;
  invoice_no: string | null;
  invoice_type: string | null;
  /** 只认 "reimbursement_request"；填了就必须给 reference_id，且那张报销单要存在。 */
  reference_type: string | null;
  reference_id: number | null;
  note: string | null;
  /** 至少一条。 */
  lines: StockDocumentLineInput[];
}

export const createStockDocument = (input: StockDocumentInput) =>
  unwrap(http.post<AssetEnvelope<AssetStockDocument>>("/asset/stock-documents", input));

/** 只有 draft 能改（后端：「只有 draft 单据才能编辑」）。 */
export const updateStockDocument = (id: number, input: StockDocumentInput) =>
  unwrap(http.patch<AssetEnvelope<AssetStockDocument>>(`/asset/stock-documents/${id}`, input));

/**
 * 确认 = **真正扣/加库存并写流水**。draft → confirmed，**没有回头路**
 * （撤销只能作废，而作废是再写一批反向流水，不是删掉原流水）。
 * 调用前必须 `confirm({ tone: "danger" })`。
 */
export const confirmStockDocument = (id: number) =>
  unwrap(http.post<AssetEnvelope<AssetStockDocument>>(`/asset/stock-documents/${id}/confirm`));

/**
 * 作废。draft 直接改状态；confirmed 会**逐条生成反向流水**把库存回滚。
 * 终态，不可撤销 —— 必须先 confirm({ tone: "danger" })。
 */
export const cancelStockDocument = (id: number) =>
  unwrap(http.post<AssetEnvelope<AssetStockDocument>>(`/asset/stock-documents/${id}/cancel`));

/**
 * 推送到「收款审核」。只有 **已确认的销售单据**（sale_out / sale_return）能推，
 * 而且**只能推一次**（后端：「这笔销售已经推送到收款审核了」）。
 * 推过去之后这笔钱由收款审核页面处理，资产这边只能看 finance_payment_status。
 * 不可撤销 —— 必须先 confirm({ tone: "danger" })。
 */
export const postStockDocumentToFinance = (id: number) =>
  unwrap(
    http.post<AssetEnvelope<AssetStockDocument>>(`/asset/stock-documents/${id}/post-to-finance`),
  );

/** 只有 draft 能删；删掉的同时会把发票文件也删了。不可撤销。 */
export const deleteStockDocument = (id: number) =>
  discard(http.delete(`/asset/stock-documents/${id}`));

/**
 * 上传 invoice 文件。
 *
 * 走 `upload` 不走 `http.post(FormData)`：上传要进度条，而 fetch 没有上传进度。
 * 字段名必须是 **"file"** —— 后端是手工遍历 multipart 取第一个叫 file 的文件部分，
 * 名字对不上它会当成「没选文件」回 400「请选择要上传的 invoice 文件」。
 *
 * 重新上传会把旧文件从盘上删掉（后端做的），所以这是个覆盖操作。
 */
export const uploadDocumentInvoice = (
  documentId: number,
  file: File,
  onProgress?: (fraction: number) => void,
) =>
  upload<AssetEnvelope<AssetStockDocument>>(
    `/asset/stock-documents/${documentId}/invoice`,
    { file },
    { onProgress, bearerToken: tokenStore.getAccess() },
  ).then((envelope) => envelope.data);

/**
 * 发票文件的浏览地址。
 *
 * `invoice_file_path` 是 DATA_ROOT 下的相对路径，后端用 `/media_file/{path}` 发文件。
 * 必须拼 API_ROOT（= origin + BASE_PATH）而不是裸写 "/media_file/…"：
 * APK 里没有同源概念，裸路径会去找 capacitor://localhost/media_file/…，点开是空白。
 *
 * ⚠️ 相册那边 (features/events/components/mediaUrl.ts) 有个一模一样的函数。
 *    现在是第二个模块要用了 —— 该提到 shared/config/paths.ts 去了，
 *    但那要动相册的调用点，留给接线的人一起做，这里先各自拼。
 */
export const invoiceFileUrl = (relativePath: string): string =>
  `${API_ROOT}/media_file/${String(relativePath).replace(/^\/+/, "")}`;
