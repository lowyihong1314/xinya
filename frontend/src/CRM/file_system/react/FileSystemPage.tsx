import { FileSystemView } from "./FileSystemView";
import { useFileSystemController } from "./useFileSystemController";

export function FileSystemPage({ embedded = false }: { embedded?: boolean }) {
  const { state, actions } = useFileSystemController();

  return (
    <FileSystemView
      embedded={embedded}
      currentPath={state.currentPath}
      tree={state.tree}
      trash={state.trash}
      trashOpen={state.trashOpen}
      setTrashOpen={actions.setTrashOpen}
      query={state.query}
      setQuery={actions.setQuery}
      viewMode={state.viewMode}
      setViewMode={actions.setViewMode}
      selectedItem={state.selectedItem}
      selectedPaths={state.selectedPaths}
      selectedDetail={state.selectedDetail}
      selectedPermissions={state.selectedPermissions}
      pagedItems={state.pagedItems}
      visibleItemCount={state.visibleItemCount}
      page={state.page}
      setPage={actions.setPage}
      loading={state.loading}
      toast={state.toast}
      permissionTargetUsers={state.permissionTargetUsers}
      permissionTargetDepartments={state.permissionTargetDepartments}
      directoryPermissionDialog={state.directoryPermissionDialog}
      fileInputRef={state.fileInputRef}
      folderInputRef={state.folderInputRef}
      onOpenDirectory={actions.openDirectory}
      onRefresh={actions.refreshCurrent}
      onCreateFolder={actions.onCreateFolder}
      onRename={actions.onRename}
      onMove={actions.onMove}
      onDelete={actions.onDelete}
      onDownloadArchive={actions.onDownloadArchive}
      onShare={actions.onShare}
      onSetDirectoryPermission={actions.onSetDirectoryPermission}
      onDirectoryPermissionDialogChange={actions.setDirectoryPermissionDialog}
      onSubmitDirectoryPermission={actions.onSubmitDirectoryPermission}
      onUploadFiles={actions.onUploadFiles}
      onRestoreTrash={actions.onRestoreTrash}
      onRemovePermission={actions.onRemovePermission}
      onSelect={actions.onSelect}
      onActivate={actions.onActivate}
      onDropOnDirectory={(dirPath, event) =>
        actions.onDropOnDirectory(dirPath, event.dataTransfer.getData("text/plain"))
      }
    />
  );
}
