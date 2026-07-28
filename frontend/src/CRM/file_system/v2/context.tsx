import { createContext, useContext, type ReactNode } from "react";

import { useFileSystemV2Controller, type FsActions, type FsState } from "./useFileSystemV2Controller";

const FsStateContext = createContext<FsState | null>(null);
const FsActionsContext = createContext<FsActions | null>(null);

export function FileSystemV2Provider({ children }: { children: ReactNode }) {
  const { state, actions } = useFileSystemV2Controller();
  return (
    <FsActionsContext.Provider value={actions}>
      <FsStateContext.Provider value={state}>{children}</FsStateContext.Provider>
    </FsActionsContext.Provider>
  );
}

export function useFsState(): FsState {
  const value = useContext(FsStateContext);
  if (!value) throw new Error("useFsState 必须在 FileSystemV2Provider 内使用");
  return value;
}

export function useFsActions(): FsActions {
  const value = useContext(FsActionsContext);
  if (!value) throw new Error("useFsActions 必须在 FileSystemV2Provider 内使用");
  return value;
}
