import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ApiError } from "@/shared/api/errors";
import { useApiQuery } from "@/shared/api/useApiQuery";
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Input,
  Label,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useConfirm,
  useToast,
} from "@/shared/ui";

import { batchDelete, createDirectory, fileKeys, listDirectory, searchFiles } from "../api";
import { ItemDialog } from "../components/ItemDialog";
import { MoveDialog } from "../components/MoveDialog";
import { PermissionsDialog } from "../components/PermissionsDialog";
import { ShareDialog } from "../components/ShareDialog";
import { UploadDialog } from "../components/UploadDialog";
import { breadcrumbs, formatSize, formatTimestamp, joinPath, normalizePath } from "../format";
import type { FileEntry, FileTarget } from "../types";

/**
 * 文件浏览。
 *
 * **单栏 + 面包屑**，没有做左树右列表：主要用户在手机上，左树在 360px 宽的屏幕上
 * 要么挤掉列表、要么变成一个抽屉（多一层交互才看得到内容）。目录树只在「移动到哪里」
 * 那个对话框里用，那里它是必需的。
 *
 * 当前目录放在 **URL 的 ?path= 上**而不是 useState 里：刷新不会跳回根目录，
 * 浏览器的前进/后退也能在目录之间走 —— 这两件事在文件管理器里是本能操作。
 */
export function FilesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const [params, setParams] = useSearchParams();
  // normalizePath 和后端的 service.normalize_path 是同一套算法，所以这里算出来的
  // 路径和后端存的那条永远对得上（?path=a/b/ 和 /a/b 是同一个目录）。
  const path = normalizePath(params.get("path"));

  const [keyword, setKeyword] = useState("");
  // 输入时不要每敲一个字就发一次请求。useDeferredValue 让输入框保持跟手，
  // 查询用滞后的值 —— 比 debounce 好在不用管定时器的清理。
  const search = useDeferredValue(keyword).trim();
  const searching = search.length > 0;

  const [selected, setSelected] = useState<FileTarget[]>([]);
  const [panel, setPanel] = useState<Panel | null>(null);

  const list = useApiQuery(fileKeys.list(path), () => listDirectory(path), {
    placeholderData: (prev) => prev, // 换目录时保留上一屏，避免列表闪一下空白
  });
  const results = useApiQuery(fileKeys.search(search), () => searchFiles(search), {
    enabled: searching,
    placeholderData: (prev) => prev,
  });

  function goTo(next: string) {
    // setParams 会整个替换 query，这正好把搜索词之外的东西清掉；
    // 选中项跟着目录走，换目录必须清空，否则会把看不见的东西一起删了。
    setParams(next === "/" ? {} : { path: next });
    setSelected([]);
  }

  const toggle = (target: FileTarget) =>
    setSelected((list_) =>
      list_.some((item) => item.path === target.path)
        ? list_.filter((item) => item.path !== target.path)
        : [...list_, target],
    );

  const removeSelected = useMutation({
    mutationFn: () => batchDelete(selected),
    // ★ 这条接口**永远 200**，逐项成败在 results 里，不看状态码。
    onSuccess: (res) => {
      const failures = res.results.filter((row) => !row.success);
      if (failures.length === 0) {
        toast.success(`已把 ${res.deleted} 项移到回收站`);
      } else {
        // 失败原因是后端给的中文原文（「没有权限」「目录不存在」…），照原样显示。
        toast.error(`${failures.length} 项没能删除：${failures[0]?.error ?? "原因未知"}`);
      }
      setSelected([]);
      void qc.invalidateQueries({ queryKey: fileKeys.all });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "删除失败"),
  });

  const crumbs = breadcrumbs(path);
  const here = crumbs[crumbs.length - 1];

  return (
    <div>
      <PageHeader
        title="文件"
        description={searching ? "搜索结果" : path === "/" ? "全部文件" : path}
        actions={
          <>
            {/* 回收站页面地址是 /files/recycle 不是 /files/trash —— 后端占了后者 */}
            <Button asChild variant="outline" size="sm">
              <Link to="/files/recycle">
                <Trash2 />
                回收站
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPanel({ kind: "new-dir" })}>
              <FolderPlus />
              新建文件夹
            </Button>
            <Button size="sm" onClick={() => setPanel({ kind: "upload" })}>
              <Upload />
              上传
            </Button>
          </>
        }
      />

      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索文件名"
          className="pl-9"
          aria-label="搜索文件名"
        />
      </div>

      {searching ? (
        <SearchResults
          isPending={results.isPending}
          error={results.isError ? results.error : null}
          onRetry={() => void results.refetch()}
          items={results.data?.items ?? []}
          truncated={results.data?.truncated ?? false}
          onOpenDir={(dirPath) => goTo(dirPath)}
          onOpenItem={(target) => setPanel({ kind: "item", target })}
        />
      ) : (
        <>
          <nav aria-label="当前路径" className="mb-3 flex flex-wrap items-center gap-1 text-sm">
            {crumbs.map((crumb, index) => (
              <span key={crumb.path} className="flex items-center gap-1">
                {index > 0 ? (
                  <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
                ) : null}
                {index === crumbs.length - 1 ? (
                  <span className="font-medium">{crumb.name}</span>
                ) : (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => goTo(crumb.path)}
                  >
                    {crumb.name}
                  </button>
                )}
              </span>
            ))}
          </nav>

          {selected.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[var(--radius-sm)] bg-primary-soft px-3 py-2 text-sm">
              <span className="text-primary-strong">已选 {selected.length} 项</span>
              <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                取消选择
              </Button>
              <Button
                variant="destructive"
                size="sm"
                loading={removeSelected.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: `删除选中的 ${selected.length} 项？`,
                    description: "都会进回收站，之后还能还原。目录会连同里面的内容一起进去。",
                    tone: "danger",
                    confirmText: "删除",
                  });
                  if (ok) removeSelected.mutate();
                }}
              >
                <Trash2 />
                删除
              </Button>
            </div>
          ) : null}

          {list.isPending ? (
            <div className="space-y-1.5">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : !list.data || (list.data.directories.length === 0 && list.data.files.length === 0) ? (
            <EmptyState
              title="这个目录是空的"
              description="右上角可以上传文件或者新建文件夹"
            />
          ) : (
            <Card>
              <CardContent className="p-0 pt-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>名称</TableHead>
                      <TableHead className="text-right">大小</TableHead>
                      <TableHead className="hidden sm:table-cell">所有者</TableHead>
                      <TableHead className="hidden md:table-cell">修改时间</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* 目录排在文件前面 —— 后端已经各自按名字排好，这里不再排第二次 */}
                    {list.data.directories.map((dir) => {
                      const target: FileTarget = { type: "dir", path: dir.path, name: dir.name };
                      return (
                        <TableRow key={dir.path}>
                          <TableCell>
                            <Checkbox
                              checked={selected.some((item) => item.path === dir.path)}
                              onChange={() => toggle(target)}
                              aria-label={`选择目录 ${dir.name}`}
                            />
                          </TableCell>
                          <TableCell>
                            <button
                              type="button"
                              className="flex min-w-0 items-center gap-2 text-left"
                              onClick={() => goTo(dir.path)}
                            >
                              <Folder className="size-4 shrink-0 text-primary" aria-hidden />
                              <span className="truncate font-medium">{dir.name}</span>
                            </button>
                          </TableCell>
                          {/* 目录行后端只给 type/name/path，没有大小、所有者和时间 */}
                          <TableCell className="text-right text-muted-foreground">—</TableCell>
                          <TableCell className="hidden sm:table-cell text-muted-foreground">
                            —
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-muted-foreground">
                            —
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`${dir.name} 的详情与操作`}
                              onClick={() => setPanel({ kind: "item", target })}
                            >
                              <MoreHorizontal />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}

                    {list.data.files.map((file) => {
                      const target = fileTarget(file);
                      return (
                        <TableRow key={file.file_id}>
                          <TableCell>
                            <Checkbox
                              checked={selected.some((item) => item.path === file.path)}
                              onChange={() => toggle(target)}
                              aria-label={`选择文件 ${file.name}`}
                            />
                          </TableCell>
                          <TableCell>
                            <button
                              type="button"
                              className="flex min-w-0 items-center gap-2 text-left"
                              onClick={() => setPanel({ kind: "item", target })}
                            >
                              <FileIcon
                                className="size-4 shrink-0 text-muted-foreground"
                                aria-hidden
                              />
                              <span className="truncate">{file.name}</span>
                            </button>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right font-mono">
                            {formatSize(file.size)}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell truncate">
                            {file.owner}
                          </TableCell>
                          <TableCell className="hidden md:table-cell whitespace-nowrap text-muted-foreground">
                            {formatTimestamp(file.updated_at)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`${file.name} 的详情与操作`}
                              onClick={() => setPanel({ kind: "item", target })}
                            >
                              <MoreHorizontal />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* 对话框一律「要用的时候才挂载」：常驻挂载 + open 开关会把上一次没提交的
          输入留到下一次打开，改完 A 再开 B 会看到 A 的内容。 */}
      {panel?.kind === "item" ? (
        <ItemDialog
          target={panel.target}
          onClose={() => setPanel(null)}
          onMove={() =>
            setPanel(panel.target.type === "file" ? { kind: "move", target: panel.target } : null)
          }
          onShare={() =>
            setPanel(panel.target.type === "file" ? { kind: "share", target: panel.target } : null)
          }
          onPermissions={() => setPanel({ kind: "permissions", target: panel.target })}
        />
      ) : null}

      {panel?.kind === "move" ? (
        <MoveDialog
          filePath={panel.target.path}
          fileName={panel.target.name}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {panel?.kind === "share" ? (
        <ShareDialog
          fileId={panel.target.file_id}
          fileName={panel.target.name}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {panel?.kind === "permissions" ? (
        <PermissionsDialog target={panel.target} onClose={() => setPanel(null)} />
      ) : null}

      {panel?.kind === "upload" ? (
        <UploadDialog
          folderLocation={path}
          folderLabel={here?.name ?? "全部文件"}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {panel?.kind === "new-dir" ? (
        <NewDirectoryDialog parentPath={path} onClose={() => setPanel(null)} />
      ) : null}
    </div>
  );
}

/**
 * 屏幕上同一时刻只有一个对话框。做成联合类型而不是几个布尔量，
 * 是因为「打开移动 → 关掉详情」这种切换用布尔量写必然会漏掉一个，
 * 于是两个对话框叠在一起。
 */
type Panel =
  | { kind: "item"; target: FileTarget }
  | { kind: "move"; target: Extract<FileTarget, { type: "file" }> }
  | { kind: "share"; target: Extract<FileTarget, { type: "file" }> }
  | { kind: "permissions"; target: FileTarget }
  | { kind: "upload" }
  | { kind: "new-dir" };

/** 列表行 → 操作目标。搜索结果里 type 可能是 "dir"，所以要分支。 */
function fileTarget(entry: FileEntry): FileTarget {
  return entry.type === "dir"
    ? { type: "dir", path: entry.path, name: entry.name }
    : { type: "file", file_id: entry.file_id, path: entry.path, name: entry.name };
}

/** 搜索结果。不做选择和批量操作：跨目录的批量删除太容易误伤。 */
function SearchResults({
  isPending,
  error,
  onRetry,
  items,
  truncated,
  onOpenDir,
  onOpenItem,
}: {
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  items: readonly FileEntry[];
  truncated: boolean;
  onOpenDir: (path: string) => void;
  onOpenItem: (target: FileTarget) => void;
}) {
  if (isPending) {
    return (
      <div className="space-y-1.5">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (items.length === 0) return <EmptyState title="没有匹配的文件" />;

  return (
    <>
      {truncated ? (
        <p className="mb-2 text-xs text-muted-foreground">结果太多，只显示前一部分。</p>
      ) : null}
      <Card>
        <CardContent className="p-0 pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>位置</TableHead>
                <TableHead className="text-right">大小</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.file_id}>
                  <TableCell>
                    <span className="flex min-w-0 items-center gap-2">
                      {item.type === "dir" ? (
                        <Folder className="size-4 shrink-0 text-primary" aria-hidden />
                      ) : (
                        <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      )}
                      <span className="truncate">{item.name}</span>
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[16rem] truncate text-muted-foreground">
                    {item.path}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono">
                    {formatSize(item.size)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={
                        item.type === "dir" ? `打开目录 ${item.name}` : `${item.name} 的详情与操作`
                      }
                      onClick={() =>
                        item.type === "dir" ? onOpenDir(item.path) : onOpenItem(fileTarget(item))
                      }
                    >
                      <MoreHorizontal />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

/** 在当前目录下建一个文件夹。中间缺的几级后端会顺手补出来。 */
function NewDirectoryDialog({
  parentPath,
  onClose,
}: {
  parentPath: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: () => createDirectory(joinPath(parentPath, name.trim())),
    onSuccess: (res) => {
      toast.success(`已新建 ${res.directory.path}`);
      void qc.invalidateQueries({ queryKey: fileKeys.all });
      onClose();
    },
    // 同名目录后端回 409「目录已存在」，直接把这句话显示出来就行。
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "新建失败"),
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>新建文件夹</DialogTitle>
        </DialogHeader>

        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Label htmlFor="new-dir-name">名称</Label>
          <Input
            id="new-dir-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：2026 年活动"
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
              新建
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
