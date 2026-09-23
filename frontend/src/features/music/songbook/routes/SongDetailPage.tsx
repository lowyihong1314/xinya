import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "@/shared/api/errors";
import { useApiQuery } from "@/shared/api/useApiQuery";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Textarea,
  useConfirm,
  useToast,
} from "@/shared/ui";
import { deleteMyEdit, fetchSong, saveMyEdit, songbookKeys } from "../api";

export function SongDetailPage() {
  const { songId } = useParams();
  const id = Number(songId);
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);

  const song = useApiQuery(songbookKeys.entry(id), () => fetchSong(id), {
    enabled: Number.isFinite(id),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: songbookKeys.entry(id) });
    // 列表里有 has_user_override 标记，也要跟着刷新
    void qc.invalidateQueries({ queryKey: [...songbookKeys.all, "list"] });
  };

  const save = useMutation({
    mutationFn: (content: string) => saveMyEdit(id, content),
    onSuccess: () => {
      toast.success("已保存我的版本");
      setDraft(null);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "保存失败"),
  });

  const revert = useMutation({
    mutationFn: () => deleteMyEdit(id),
    onSuccess: () => {
      toast.success("已回到原版");
      setDraft(null);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "操作失败"),
  });

  if (song.isPending) return <LoadingState />;
  if (song.isError) return <ErrorState error={song.error} onRetry={() => void song.refetch()} />;
  // 歌曲 id 不是数字时查询被禁用（enabled:false），这里会走到 ——
  // 渲染 404 而不是永久转圈（isPending 为 false 不等于一定有数据，见 useApiQuery）
  if (!song.data) return <EmptyState title="找不到这首歌" description="链接里的编号不正确。" />;

  const data = song.data;
  const editing = draft !== null;

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link to="/music/songbook">
          <ArrowLeft />
          歌本
        </Link>
      </Button>

      <PageHeader
        title={data.title}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            {data.song_number ? <span>第 {data.song_number} 首</span> : null}
            {data.variant ? <Badge variant="neutral">{data.variant}</Badge> : null}
            {data.selected_key ? <Badge variant="primary">{data.selected_key}</Badge> : null}
            {data.has_user_override ? <Badge variant="info">我的版本</Badge> : null}
          </span>
        }
        actions={
          editing ? null : (
            <>
              <Button variant="outline" size="sm" onClick={() => setDraft(data.active_version ?? "")}>
                <Pencil />
                改成我的版本
              </Button>
              {data.has_user_override ? (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={revert.isPending}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: "回到原版？",
                        description: "你自己改过的内容会被删掉，这一步不可撤销。",
                        tone: "danger",
                        confirmText: "回到原版",
                      })
                    ) {
                      revert.mutate();
                    }
                  }}
                >
                  <RotateCcw />
                  回到原版
                </Button>
              ) : null}
            </>
          )
        }
      />

      <Card>
        <CardContent className="pt-5">
          {editing ? (
            <div className="space-y-3">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="min-h-[60svh] font-mono text-sm leading-7"
                aria-label="歌词内容"
              />
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setDraft(null)}>
                  取消
                </Button>
                <Button loading={save.isPending} onClick={() => save.mutate(draft)}>
                  保存
                </Button>
              </div>
            </div>
          ) : (
            // font-mono + whitespace-pre-wrap：歌词里的和弦是靠空格对齐到字上方的，
            // 用比例字体或折叠空格会让和弦全部错位。
            <pre className="whitespace-pre-wrap font-mono text-sm leading-7">
              {data.active_version || "（还没有内容）"}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
