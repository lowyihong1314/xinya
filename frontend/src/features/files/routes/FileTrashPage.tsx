import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RotateCcw, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

import { ApiError } from "@/shared/api/errors";
import { useApiQuery } from "@/shared/api/useApiQuery";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useConfirm,
  useToast,
} from "@/shared/ui";

import { fetchTrash, fileKeys, purgeAllTrash, purgeTrash, restoreTrash } from "../api";
import { formatSize, formatTimestamp } from "../format";

/**
 * 回收站。
 *
 * ⚠️ 页面地址是 /files/recycle，不是 /files/trash —— 后端有 GET /files/trash，
 *    叫那个名字的话 nginx 会把请求交给后端，用户点开只会下载一坨 JSON。
 *    （scripts/check-route-collisions.mjs 比的就是这种完整路径重合。）
 *
 * ★ 列表按 **owner_id** 过滤，不是「谁删的」：别人删掉我的文件，出现在**我**的回收站里。
 *   所以这一页看到的东西可能不是自己删的，文案上不要写成「我删除的文件」。
 */
export function FileTrashPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const trash = useApiQuery(fileKeys.trash(), fetchTrash);

  // 还原会把条目变回文件、彻底删除会改变列表 —— 两者都让整个 files 域失效，
  // 因为目录列表和目录树同样会变。
  const invalidate = () => qc.invalidateQueries({ queryKey: fileKeys.all });
  const fail = (err: unknown) => toast.error(err instanceof ApiError ? err.message : "操作失败");

  const restore = useMutation({
    mutationFn: (trashId: number) => restoreTrash(trashId),
    onSuccess: (res) => {
      toast.success(`已还原到 ${res.path}`);
      void invalidate();
    },
    // 原路径被新文件占了会 409「目标已存在」，那句话本身就说清楚了。
    onError: fail,
  });

  const purgeOne = useMutation({
    mutationFn: (trashId: number) => purgeTrash(trashId),
    onSuccess: () => {
      toast.success("已彻底删除");
      void invalidate();
    },
    onError: fail,
  });

  const purgeAll = useMutation({
    mutationFn: purgeAllTrash,
    onSuccess: (res) => {
      toast.success(`已清空 ${res.purged} 项`);
      void invalidate();
    },
    onError: fail,
  });

  const items = trash.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="回收站"
        description="删掉的文件会先放在这里，还原之前不占用原来的位置"
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/files">
                <ArrowLeft />
                返回文件
              </Link>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              loading={purgeAll.isPending}
              disabled={items.length === 0}
              onClick={async () => {
                const ok = await confirm({
                  title: "清空回收站？",
                  description: `${items.length} 项会从磁盘上删掉，不能再还原。`,
                  tone: "danger",
                  confirmText: "清空",
                });
                if (ok) purgeAll.mutate();
              }}
            >
              <Trash2 />
              清空
            </Button>
          </>
        }
      />

      {trash.isPending ? (
        <LoadingState />
      ) : trash.isError ? (
        <ErrorState error={trash.error} onRetry={() => void trash.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="回收站是空的" />
      ) : (
        <Card>
          <CardContent className="p-0 pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>原路径</TableHead>
                  <TableHead className="text-right">大小</TableHead>
                  <TableHead className="hidden sm:table-cell">删除时间</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-[18rem] truncate">{item.path}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">
                      {formatSize(item.size)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell whitespace-nowrap text-muted-foreground">
                      {formatTimestamp(item.deleted_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`还原 ${item.path}`}
                          title="还原"
                          disabled={restore.isPending}
                          onClick={() => restore.mutate(item.id)}
                        >
                          <RotateCcw />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`彻底删除 ${item.path}`}
                          title="彻底删除"
                          disabled={purgeOne.isPending}
                          onClick={async () => {
                            const ok = await confirm({
                              title: "彻底删除？",
                              description: `${item.path} 会从磁盘上删掉，不能再还原。`,
                              tone: "danger",
                              confirmText: "彻底删除",
                            });
                            if (ok) purgeOne.mutate(item.id);
                          }}
                        >
                          <Trash2 className="text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
