import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { ApiError } from "@/shared/api/errors";
import { Button, useToast } from "@/shared/ui";

import { assetKeys, invoiceFileUrl, uploadDocumentInvoice } from "../api";
import type { AssetStockDocument } from "../types";

/**
 * 单据的 invoice 文件：看一眼 + 换一份。
 *
 * ★ 上传**不受单据状态限制**（后端那条路由没有状态判断）—— 单据确认之后才拿到发票
 *   是常态，所以已确认、已作废的单据也能补传。
 *
 * ★ 重新上传是**覆盖**：后端存好新文件之后会把旧文件从盘上删掉。
 *
 * 走 shared/api/upload 而不是 http.post(FormData)：要进度条，而 fetch 没有上传进度。
 */
export function InvoiceUpload({
  // 解构成 doc：叫 document 会把全局的 `document` 在整个函数体里遮掉。
  document: doc,
  canEdit,
}: {
  document: AssetStockDocument;
  canEdit: boolean;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const send = useMutation({
    mutationFn: (file: File) => uploadDocumentInvoice(doc.id, file, setProgress),
    onSuccess: () => {
      toast.success("invoice 文件已上传");
      void qc.invalidateQueries({ queryKey: assetKeys.all });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "上传失败"),
    onSettled: () => setProgress(null),
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {doc.invoice_file_path ? (
        <Button asChild variant="outline" size="sm">
          {/* asChild 只能有单一子节点 —— 图标和文字都塞进 <a> 里，<a> 自己是那一个节点 */}
          <a href={invoiceFileUrl(doc.invoice_file_path)} target="_blank" rel="noreferrer">
            <FileText />
            {doc.invoice_file_name || "查看 invoice"}
          </a>
        </Button>
      ) : (
        <span className="text-sm text-muted-foreground">还没有 invoice 文件</span>
      )}

      {canEdit ? (
        <>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // 选完就把 input 清空：不清的话连续选同一个文件不会触发 change。
              e.target.value = "";
              if (file) send.mutate(file);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            loading={send.isPending}
            onClick={() => inputRef.current?.click()}
          >
            <Upload />
            {doc.invoice_file_path ? "换一份" : "上传 invoice"}
          </Button>
          {progress !== null ? (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {Math.round(progress * 100)}%
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
