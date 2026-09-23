import { useMutation, useQueryClient } from "@tanstack/react-query";
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
  Label,
  LoadingState,
  Select,
  useToast,
} from "@/shared/ui";

import { fetchTree, fileKeys, moveFile } from "../api";
import { parentPath } from "../format";

/**
 * 把一个文件移到别的目录。
 *
 * ★ 只有文件能移：后端 move_file 只改被移那一行的 path，移目录的话子项会留在原地
 *   （接口注释里写明了「本来就只给文件用」）。目录要挪位置只能重命名。
 *
 * ⚠️ 候选目录取自 /files/tree，而它的 directories 是从**子项路径反推**出来的、
 *    并且不含最后一段 —— **空的深层目录不会出现在候选里**（"/a/b" 里没东西时，
 *    树上只有 "/a"）。这是后端 build_tree 的既有行为，不是这里漏了。
 */
export function MoveDialog({
  filePath,
  fileName,
  onClose,
}: {
  filePath: string;
  fileName: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const currentParent = parentPath(filePath);
  const [target, setTarget] = useState(currentParent);

  const tree = useApiQuery(fileKeys.tree(), fetchTree);

  const move = useMutation({
    mutationFn: () => moveFile(filePath, target),
    onSuccess: (res) => {
      toast.success(`已移到 ${res.new_path}`);
      void qc.invalidateQueries({ queryKey: fileKeys.all });
      onClose();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "移动失败"),
  });

  // 根目录后端不会放进 directories（它是从子项反推的），但它永远是个合法目标；
  // 当前所在目录也补进来，否则「移回原处」这个选项可能根本不在列表里。
  const options = Array.from(
    new Set(["/", currentParent, ...(tree.data?.directories ?? [])]),
  ).sort();

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>移动文件</DialogTitle>
          <DialogDescription>{fileName}</DialogDescription>
        </DialogHeader>

        {tree.isPending ? (
          <LoadingState className="min-h-24" />
        ) : tree.isError ? (
          <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />
        ) : (
          <div className="space-y-2">
            <Label htmlFor="move-target">移动到</Label>
            <Select
              id="move-target"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              {options.map((dir) => (
                <option key={dir} value={dir}>
                  {dir === "/" ? "/（全部文件）" : dir}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              空目录可能不在这个列表里（后端的目录树是从子项反推出来的）。
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={() => move.mutate()}
            loading={move.isPending}
            disabled={tree.isPending || target === currentParent}
          >
            移动
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
