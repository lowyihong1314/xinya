/**
 * 轻提示（Toast）。
 *
 * 旧前端用 sweetalert2 弹模态来报「保存成功」—— 模态会打断操作、需要点确认，
 * 对一个高频动作来说太重。这里改成右下角的轻提示，自动消失，不阻塞。
 * **需要用户做决定的场合用 Dialog/confirm，不要用 toast。**
 */
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "../lib/cn";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONS: Record<ToastKind, typeof Info> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const TONE: Record<ToastKind, string> = {
  success: "border-success/30 bg-success-soft text-success",
  error: "border-destructive/30 bg-destructive-soft text-destructive",
  info: "border-border bg-card text-foreground",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  // useRef 而不是 useState 计数：id 只是唯一标识，不该触发重渲染。
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setItems((list) => [...list, { id, kind, message }]);
      // 错误停留久一点：用户往往要把文案看完甚至截图。
      window.setTimeout(() => remove(id), kind === "error" ? 6000 : 3000);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* aria-live=polite：读屏软件会在用户当前朗读结束后播报，不打断 */}
      <div
        className="pointer-events-none fixed bottom-0 right-0 z-[60] flex w-full max-w-sm flex-col gap-2 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
        aria-live="polite"
        aria-atomic="false"
      >
        {items.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <div
              key={t.id}
              className={cn(
                "pointer-events-auto flex items-start gap-2 rounded-[var(--radius-sm)] border px-3 py-2.5 shadow-lg",
                "animate-in slide-in-from-bottom-2 fade-in-0",
                TONE[t.kind],
              )}
              role={t.kind === "error" ? "alert" : "status"}
            >
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 text-sm break-words">{t.message}</span>
              <button
                type="button"
                onClick={() => remove(t.id)}
                className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
                aria-label="关闭提示"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast 必须在 <ToastProvider> 内使用");
  return ctx;
}
