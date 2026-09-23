import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/shared/api/errors";
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

import { fileKeys, uploadFile } from "../api";
import { formatSize } from "../format";

type TaskStatus = "waiting" | "uploading" | "done" | "failed";

interface Task {
  file: File;
  /** 0–1。upload() 走 XHR 才有上传进度，fetch 没有。 */
  progress: number;
  status: TaskStatus;
  error?: string;
}

/**
 * 上传到当前目录。
 *
 * ★ 调用方**只在要用的时候才挂载它**，这样每次打开都是空的任务列表。
 *
 * 这里刻意做成「一个文件一个请求、串行跑」，理由在 api.ts 的 uploadFile 上：
 * 一次一个才和后端的 relative_paths[] 对得齐，也才有逐个的进度和逐个的失败。
 * 串行而不是并发，是因为后端每传一个文件都要逐级「先查目录记录、没有就插」，
 * 并发往同一个新目录传会撞在那一步上。
 */
export function UploadDialog({
  folderLocation,
  folderLabel,
  onClose,
}: {
  /** 传给后端的 folder_location（根目录是 "/"）。 */
  folderLocation: string;
  /** 给人看的目录名。 */
  folderLabel: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [tasks, setTasks] = useState<Task[]>([]);

  const patch = (index: number, next: Partial<Task>) =>
    setTasks((list) => list.map((task, i) => (i === index ? { ...task, ...next } : task)));

  const run = useMutation({
    mutationFn: async (items: readonly Task[]) => {
      let ok = 0;
      let failed = 0;
      for (const [index, task] of items.entries()) {
        patch(index, { status: "uploading", progress: 0, error: undefined });
        try {
          await uploadFile(task.file, folderLocation, {
            onProgress: (fraction) => patch(index, { progress: fraction }),
          });
          patch(index, { status: "done", progress: 1 });
          ok += 1;
        } catch (err) {
          // 一个失败不打断后面的：同名文件后端回 409，用户多半希望其它几个照传。
          patch(index, {
            status: "failed",
            error: err instanceof ApiError ? err.message : "上传失败",
          });
          failed += 1;
        }
      }
      return { ok, failed };
    },
    onSuccess: ({ ok, failed }) => {
      if (ok > 0) void qc.invalidateQueries({ queryKey: fileKeys.all });
      if (failed === 0) {
        toast.success(`已上传 ${ok} 个文件`);
        onClose();
        return;
      }
      // 失败的那几条在列表里各自带着后端的中文原因，这里只报个数。
      toast.error(ok > 0 ? `${ok} 个成功，${failed} 个失败` : `${failed} 个文件都没传上去`);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "上传失败"),
  });

  const pending = tasks.some((task) => task.status === "waiting");

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>上传文件</DialogTitle>
          <DialogDescription>传到「{folderLabel}」</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="upload-picker">选择文件</Label>
          <Input
            id="upload-picker"
            type="file"
            multiple
            disabled={run.isPending}
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? []);
              setTasks(picked.map((file) => ({ file, progress: 0, status: "waiting" })));
            }}
          />
        </div>

        {tasks.length > 0 ? (
          <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto">
            {tasks.map((task, index) => (
              <li key={`${task.file.name}-${index}`} className="space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{task.file.name}</span>
                  {task.status === "done" ? (
                    <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="已上传" />
                  ) : task.status === "failed" ? (
                    <XCircle className="size-4 shrink-0 text-destructive" aria-label="失败" />
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatSize(task.file.size)}
                    </span>
                  )}
                </div>
                {/* 进度条用令牌色，不写具体色值 */}
                <div className="h-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={
                      task.status === "failed"
                        ? "h-full bg-destructive transition-[width]"
                        : "h-full bg-primary transition-[width]"
                    }
                    style={{ width: `${Math.round(task.progress * 100)}%` }}
                  />
                </div>
                {task.error ? <p className="text-xs text-destructive">{task.error}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={run.isPending}>
            {tasks.some((task) => task.status === "done") ? "完成" : "取消"}
          </Button>
          <Button
            onClick={() => run.mutate(tasks)}
            loading={run.isPending}
            disabled={tasks.length === 0 || !pending}
          >
            开始上传
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
