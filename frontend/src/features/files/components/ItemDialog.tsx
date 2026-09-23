import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, FolderInput, Share2, Shield, Trash2 } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/shared/api/errors";
import { useApiQuery } from "@/shared/api/useApiQuery";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Input,
  Label,
  LoadingState,
  useConfirm,
  useToast,
} from "@/shared/ui";

import {
  deleteDirectory,
  deleteFiles,
  fetchDirectoryDetail,
  fetchFileDetail,
  fileContentUrl,
  fileKeys,
  renameDirectory,
  renameFile,
} from "../api";
import { actionLabel, formatSize, formatTimestamp } from "../format";
import type { FileTarget } from "../types";

/**
 * 一个条目的详情与操作。目录和文件共用这一个对话框，因为它们在界面上是同一种东西
 * （表格里的一行），只是能做的事不一样。
 *
 * ★ 目录与文件**几乎每条接口都是分开的**：重命名、删除、查详情各有一条，
 *   连主键都不同（文件是 file_id，目录只有 path）。所以这里到处是 target.type 的分支，
 *   不是可以合并的重复代码。
 *
 * 移动 / 分享 / 权限不在这里直接弹：Radix 的对话框可以嵌套，但嵌套之后焦点和
 * Esc 的归属很难讲清楚。改成**先关掉自己、再由页面打开下一个**，这样任何时刻
 * 屏幕上只有一个对话框。
 */
export function ItemDialog({
  target,
  onClose,
  onMove,
  onShare,
  onPermissions,
}: {
  target: FileTarget;
  onClose: () => void;
  onMove: () => void;
  onShare: () => void;
  onPermissions: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [name, setName] = useState(target.name);

  const isFile = target.type === "file";
  const fileId = target.type === "file" ? target.file_id : null;

  const fileDetail = useApiQuery(
    fileKeys.detail(fileId ?? 0),
    () => fetchFileDetail(fileId ?? 0),
    { enabled: fileId !== null },
  );
  const dirDetail = useApiQuery(
    fileKeys.directoryDetail(target.path),
    () => fetchDirectoryDetail(target.path),
    { enabled: !isFile },
  );

  const done = (message: string) => {
    toast.success(message);
    // 一次把 fileKeys 全作废：改一个条目会同时影响目录列表、目录树、搜索结果和详情，
    // 逐个挑 key 只会漏掉其中一个，然后表现成「改完了但列表没变」。
    void qc.invalidateQueries({ queryKey: fileKeys.all });
    onClose();
  };
  const fail = (err: unknown) => toast.error(err instanceof ApiError ? err.message : "操作失败");

  const rename = useMutation({
    mutationFn: () =>
      target.type === "file"
        ? renameFile(target.file_id, name.trim())
        : renameDirectory(target.path, name.trim()),
    onSuccess: () => done("已重命名"),
    onError: fail,
  });

  const remove = useMutation({
    // 文件按 id 删、目录按 path 删 —— 两条不同的接口，都是移进回收站不是真删。
    mutationFn: () =>
      target.type === "file" ? deleteFiles([target.file_id]) : deleteDirectory(target.path),
    onSuccess: () => done("已移到回收站"),
    onError: fail,
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="break-all">{target.name}</DialogTitle>
          <DialogDescription className="break-all">{target.path}</DialogDescription>
        </DialogHeader>

        {/* ── 详情 ───────────────────────────────────────────── */}
        {isFile ? (
          fileDetail.isPending ? (
            <LoadingState className="min-h-20" />
          ) : fileDetail.isError ? (
            <ErrorState error={fileDetail.error} onRetry={() => void fileDetail.refetch()} />
          ) : fileDetail.data ? (
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <Field label="大小" value={formatSize(fileDetail.data.file_size)} />
              <Field label="类型" value={fileDetail.data.file_type} />
              <Field label="上传时间" value={formatTimestamp(fileDetail.data.created_at)} />
              <Field label="修改时间" value={formatTimestamp(fileDetail.data.updated_at)} />
            </dl>
          ) : null
        ) : dirDetail.isPending ? (
          <LoadingState className="min-h-20" />
        ) : dirDetail.isError ? (
          <ErrorState error={dirDetail.error} onRetry={() => void dirDetail.refetch()} />
        ) : dirDetail.data ? (
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {/* 统计只算当前用户读得到的那些子项，所以两个人看到的数字可能不一样 */}
            <Field label="文件数" value={`${dirDetail.data.file_count} 个`} />
            <Field label="子目录" value={`${dirDetail.data.sub_dir_count} 个`} />
            <Field label="合计大小" value={formatSize(dirDetail.data.total_size)} />
            <Field label="创建时间" value={formatTimestamp(dirDetail.data.created_at)} />
          </dl>
        ) : null}

        {/* ── 重命名 ─────────────────────────────────────────── */}
        <form
          className="mt-4 space-y-2 border-t border-border pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && name.trim() !== target.name) rename.mutate();
          }}
        >
          <Label htmlFor="item-name">名称</Label>
          <div className="flex gap-2">
            <Input
              id="item-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              // 文件名合法性交给后端：重名回 409「目标文件已存在」，
              // 前端再写一套校验文案只会和后端漂移。
              placeholder={target.name}
            />
            <Button
              type="submit"
              variant="outline"
              loading={rename.isPending}
              disabled={!name.trim() || name.trim() === target.name}
            >
              重命名
            </Button>
          </div>
        </form>

        {/* ── 操作 ───────────────────────────────────────────── */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          {target.type === "file" ? (
            <>
              {/* asChild 只能有单一子节点：图标和文字都塞进 <a> 里面，<a> 本身才是那一个 */}
              <Button asChild variant="outline" size="sm">
                <a href={fileContentUrl(target.file_id)} download={target.name}>
                  <Download />
                  下载
                </a>
              </Button>
              <Button variant="outline" size="sm" onClick={onMove}>
                <FolderInput />
                移动
              </Button>
              <Button variant="outline" size="sm" onClick={onShare}>
                <Share2 />
                分享
              </Button>
            </>
          ) : null}

          <Button variant="outline" size="sm" onClick={onPermissions}>
            <Shield />
            权限
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="text-destructive"
            loading={remove.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: target.type === "dir" ? "删除这个目录？" : "删除这个文件？",
                description:
                  target.type === "dir"
                    ? `「${target.name}」连同里面的所有内容都会进回收站。`
                    : `「${target.name}」会进回收站，可以再还原回来。`,
                tone: "danger",
                confirmText: "删除",
              });
              if (ok) remove.mutate();
            }}
          >
            <Trash2 />
            删除
          </Button>
        </div>

        {/* ── 最近操作（只有文件有）───────────────────────────── */}
        {isFile && fileDetail.data?.history.length ? (
          <section className="mt-4 border-t border-border pt-4">
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">最近操作</h3>
            <ul className="space-y-1 text-sm">
              {fileDetail.data.history.map((row) => (
                <li key={row.id} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {actionLabel(row.action)}
                    <span className="text-muted-foreground"> · {row.user_name || "—"}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatTimestamp(row.timestamp)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate">{value}</dd>
    </div>
  );
}
