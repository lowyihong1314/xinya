import { useMutation } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/shared/api/errors";
import { publicUrl } from "@/shared/config/paths";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  useToast,
} from "@/shared/ui";

import { createShare } from "../api";
import type { ShareResponse } from "../types";

/**
 * 生成一条公开下载链接。
 *
 * ★ 后端要的是 **write** 权限（不是 read）—— 只读的人看得到文件，但分享会 403。
 * ★ 有效期和次数是**两道独立的闸**：过期或者次数用完，哪一个先到链接就失效。
 *
 * 不需要 invalidate 任何查询：分享不改动文件本身，列表里什么都不会变。
 */
export function ShareDialog({
  fileId,
  fileName,
  onClose,
}: {
  fileId: number;
  fileName: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [minutes, setMinutes] = useState("10");
  const [credit, setCredit] = useState("1");
  const [result, setResult] = useState<ShareResponse | null>(null);

  const create = useMutation({
    // 两个值都必须带上：后端默认值写在路由的 data.get(…, 10) 上，显式传 null
    // 会进到 nullable=False 的列里，commit 时 500。所以这里兜底成后端同款默认值。
    mutationFn: () => createShare(fileId, Number(minutes) || 10, Number(credit) || 1),
    onSuccess: (res) => setResult(res),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "生成链接失败"),
  });

  // 后端给的是应用内裸路径（不带 BASE_PATH、不带 origin），要过一次 publicUrl()：
  // location.origin 在 APK 里是 capacitor://localhost，拿它拼出来的链接发出去打不开。
  const shareUrl = result ? publicUrl(result.share_url) : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("链接已复制");
    } catch {
      // http 页面 / 旧 WebView 没有 clipboard API。链接就在下面的输入框里，
      // 让用户自己长按复制，比弹一个「复制失败」有用。
      toast.info("请长按上面的链接手动复制");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>分享链接</DialogTitle>
          <DialogDescription>{fileName}</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-2">
            <Label htmlFor="share-url">任何人拿到这条链接都能下载</Label>
            <div className="flex gap-2">
              <Input id="share-url" value={shareUrl} readOnly onFocus={(e) => e.target.select()} />
              <Button variant="outline" size="icon" onClick={() => void copy()} aria-label="复制链接">
                <Copy />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {result.expire_minutes} 分钟内有效，可下载 {result.credit} 次；先到的那个生效。
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="share-minutes">有效期（分钟）</Label>
              <Input
                id="share-minutes"
                type="number"
                min={1}
                inputMode="numeric"
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="share-credit">可下载次数</Label>
              <Input
                id="share-credit"
                type="number"
                min={1}
                inputMode="numeric"
                value={credit}
                onChange={(event) => setCredit(event.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {result ? "完成" : "取消"}
          </Button>
          {result ? null : (
            <Button onClick={() => create.mutate()} loading={create.isPending}>
              生成链接
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
