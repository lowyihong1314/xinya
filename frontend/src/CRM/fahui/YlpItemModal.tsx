// 牌位项目的新增/编辑弹窗：原本写在 FahuiPage 里，抽出来给订单摘要抽屉一起用。
import { createYlpOrderItem, updateYlpOrderItem } from "./api";
import { PaiweiEditorModal } from "./intake/PaiweiEditorModal";
import { buildItemPayload, createDraft, draftFromItem } from "./intake/paiwei";
import type { YlpOrderItem } from "./types";

export function YlpItemModal({
  orderId,
  item,
  relationOptions,
  onClose,
  onSaved,
}: {
  orderId: number;
  item: YlpOrderItem | null;
  relationOptions: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = item != null;
  return (
    <PaiweiEditorModal
      initialDraft={item ? draftFromItem(item) : createDraft("A1")}
      isEdit={isEdit}
      relationOptions={relationOptions}
      saveLabel={isEdit ? "保存修改" : "添加牌位"}
      onCancel={onClose}
      onSave={async (draft) => {
        const payload = buildItemPayload(draft);
        if (item) {
          await updateYlpOrderItem(orderId, item.id, payload);
        } else {
          await createYlpOrderItem(orderId, payload);
        }
        onSaved();
      }}
    />
  );
}
