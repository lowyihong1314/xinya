import { useFsActions, useFsState } from "../context";
import {
  dangerButtonStyle,
  primaryButtonStyle,
  selectionBarStyle,
  selectionCountStyle,
  softButtonStyle,
  toolbarStyle,
} from "../styles";

export function Toolbar() {
  const { selection, selectedItems, trash, fileInputRef, folderInputRef } = useFsState();
  const actions = useFsActions();
  const hasSelection = selection.size > 0;

  return (
    <div style={toolbarStyle}>
      {hasSelection ? (
        <div style={selectionBarStyle}>
          <span style={selectionCountStyle}>已选 {selection.size} 项</span>
          <button type="button" style={softButtonStyle} onClick={() => actions.openDialog({ kind: "move", items: selectedItems })}>
            <i className="fa-solid fa-arrows-up-down-left-right" /> 移动
          </button>
          <button type="button" style={softButtonStyle} onClick={() => actions.downloadArchiveOf(selectedItems)}>
            <i className="fa-solid fa-file-zipper" /> 打包下载
          </button>
          {selection.size === 1 ? (
            <button type="button" style={softButtonStyle} onClick={() => actions.openDialog({ kind: "rename", item: selectedItems[0] })}>
              <i className="fa-solid fa-pen" /> 重命名
            </button>
          ) : null}
          {selection.size === 1 && selectedItems[0]?.type === "file" ? (
            <button type="button" style={softButtonStyle} onClick={() => actions.openDialog({ kind: "share", item: selectedItems[0] })}>
              <i className="fa-solid fa-share-nodes" /> 分享
            </button>
          ) : null}
          <button type="button" style={dangerButtonStyle} onClick={() => actions.deleteItems(selectedItems)}>
            <i className="fa-solid fa-trash-can" /> 删除
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" style={softButtonStyle} onClick={actions.clearSelection}>
            <i className="fa-solid fa-xmark" /> 取消选择
          </button>
        </div>
      ) : (
        <>
          <button type="button" style={primaryButtonStyle} onClick={() => fileInputRef.current?.click()}>
            <i className="fa-solid fa-arrow-up-from-bracket" /> 上传文件
          </button>
          <button type="button" style={softButtonStyle} onClick={() => folderInputRef.current?.click()}>
            <i className="fa-solid fa-folder-plus" /> 上传文件夹
          </button>
          <button type="button" style={softButtonStyle} onClick={() => actions.openDialog({ kind: "newFolder" })}>
            <i className="fa-solid fa-plus" /> 新建文件夹
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" style={softButtonStyle} onClick={actions.refreshCurrent}>
            <i className="fa-solid fa-rotate-right" /> 刷新
          </button>
          <button type="button" style={softButtonStyle} onClick={() => actions.setTrashOpen(true)}>
            <i className="fa-solid fa-trash-can" /> 回收站{trash.length ? `（${trash.length}）` : ""}
          </button>
        </>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          actions.uploadFileList(files, files.map((file) => file.name));
          event.target.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        {...({ webkitdirectory: "" } as Record<string, string>)}
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          actions.uploadFileList(files, files.map((file) => file.webkitRelativePath || file.name));
          event.target.value = "";
        }}
      />
    </div>
  );
}
