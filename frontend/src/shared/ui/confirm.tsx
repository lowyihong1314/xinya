/**
 * 确认对话框。替代旧前端的 showConfirmDialog（src/js/dialogs.tsx）。
 *
 * 做成 Promise 风格的 hook，调用点读起来是顺的：
 *
 *     const confirm = useConfirm();
 *     if (!(await confirm({ title: "删除这条报销单？", tone: "danger" }))) return;
 *     await remove(id);
 *
 * 比传 onConfirm 回调好在：调用点不用把后续逻辑拆到另一个函数里去。
 */
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "./Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./Dialog";

export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** danger 会把确认按钮变成红色。删除、撤销这类不可逆操作用它。 */
  tone?: "default" | "danger";
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  // resolve 存 ref 而不是 state：它变化时不需要重渲染，
  // 而且放 state 里会因为闭包旧值导致「点了确认但 Promise 不 resolve」。
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const settle = useCallback((result: boolean) => {
    setOptions(null);
    resolveRef.current?.(result);
    resolveRef.current = null;
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={options !== null}
        // 点遮罩/按 Esc 关闭 = 取消。不 settle 的话 await 会永远挂着。
        onOpenChange={(open) => {
          if (!open) settle(false);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{options?.title}</DialogTitle>
            {options?.description ? <DialogDescription>{options.description}</DialogDescription> : null}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => settle(false)}>
              {options?.cancelText ?? "取消"}
            </Button>
            <Button
              variant={options?.tone === "danger" ? "destructive" : "primary"}
              onClick={() => settle(true)}
              autoFocus
            >
              {options?.confirmText ?? "确定"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm 必须在 <ConfirmProvider> 内使用");
  return ctx;
}
