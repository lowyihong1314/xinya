import { useRef, useState, type DragEvent } from "react";

import { FileSystemV2Provider, useFsActions, useFsState } from "./context";
import { ContextMenu } from "./components/ContextMenu";
import { DetailDrawer } from "./components/DetailDrawer";
import { FilePreviewModal } from "./components/FilePreviewModal";
import { ItemGrid } from "./components/ItemGrid";
import { ItemList } from "./components/ItemList";
import { SearchResults } from "./components/SearchResults";
import { Toolbar } from "./components/Toolbar";
import { TopBar } from "./components/TopBar";
import { TrashPanel } from "./components/TrashPanel";
import { TreeSidebar } from "./components/TreeSidebar";
import { DialogHost } from "./components/dialogs/DialogHost";
import { collectDroppedFiles } from "./components/externalDrop";
import { isExternalFileDrag } from "./components/dragPayload";
import {
  bodyStyle,
  dropOverlayStyle,
  loadingOverlayStyle,
  mainStyle,
  rootStyle,
  softButtonStyle,
  statusBarStyle,
  toastStyle,
} from "./styles";

export function FileSystemV2Page() {
  return (
    <FileSystemV2Provider>
      <FileSystemV2Layout />
    </FileSystemV2Provider>
  );
}

function FileSystemV2Layout() {
  const { isMobile, viewMode, loading, toast, totalCount, visibleCount, searchResult, currentPath } = useFsState();
  const actions = useFsActions();
  const [externalDrag, setExternalDrag] = useState(false);
  // dragenter/dragleave 会在子元素间反复触发，用计数器防止高亮闪烁
  const dragCounter = useRef(0);

  function onDragEnter(event: DragEvent) {
    if (!isExternalFileDrag(event)) return;
    event.preventDefault();
    dragCounter.current += 1;
    setExternalDrag(true);
  }

  function onDragOver(event: DragEvent) {
    if (!isExternalFileDrag(event)) return;
    event.preventDefault();
  }

  function onDragLeave(event: DragEvent) {
    if (!isExternalFileDrag(event)) return;
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setExternalDrag(false);
  }

  async function onDrop(event: DragEvent) {
    if (!isExternalFileDrag(event)) return;
    event.preventDefault();
    dragCounter.current = 0;
    setExternalDrag(false);
    const { files, relativePaths } = await collectDroppedFiles(event.dataTransfer);
    if (files.length) {
      actions.uploadFileList(files, relativePaths);
    }
  }

  const showingSearch = searchResult !== null;

  return (
    <div
      style={rootStyle(isMobile)}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(event) => void onDrop(event)}
    >
      <TopBar />
      <Toolbar />
      <div style={bodyStyle}>
        <TreeSidebar />
        <main style={mainStyle} onClick={() => actions.setContextMenu(null)}>
          {showingSearch ? <SearchResults /> : viewMode === "list" ? <ItemList /> : <ItemGrid />}
        </main>
      </div>
      <div style={statusBarStyle}>
        <span>{showingSearch ? "全局搜索结果" : `${currentPath === "/" ? "根目录" : currentPath} · 共 ${totalCount} 项`}</span>
        {!showingSearch && visibleCount < totalCount ? (
          <button type="button" style={{ ...softButtonStyle, padding: "3px 12px", fontSize: 12 }} onClick={actions.loadMore}>
            加载更多（已显示 {visibleCount}/{totalCount}）
          </button>
        ) : null}
      </div>

      <DetailDrawer />
      <TrashPanel />
      <ContextMenu />
      <DialogHost />
      <FilePreviewModal />

      {externalDrag ? (
        <div style={dropOverlayStyle}>
          <i className="fa-solid fa-cloud-arrow-up" style={{ fontSize: 40 }} />
          松开鼠标，上传到 {currentPath === "/" ? "根目录" : currentPath}
        </div>
      ) : null}

      {loading ? (
        <div style={loadingOverlayStyle}>
          <i className="fa-solid fa-circle-notch fa-spin" />
          处理中…
        </div>
      ) : null}

      {toast ? <div style={toastStyle(toast.tone)}>{toast.message}</div> : null}
    </div>
  );
}
