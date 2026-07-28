import { useFsState } from "../../context";
import { DirPermissionDialog } from "./DirPermissionDialog";
import { MoveDialog } from "./MoveDialog";
import { NewFolderDialog } from "./NewFolderDialog";
import { RenameDialog } from "./RenameDialog";
import { ShareDialog } from "./ShareDialog";

export function DialogHost() {
  const { activeDialog } = useFsState();
  if (!activeDialog) return null;

  switch (activeDialog.kind) {
    case "rename":
      return <RenameDialog item={activeDialog.item} />;
    case "newFolder":
      return <NewFolderDialog />;
    case "share":
      return <ShareDialog item={activeDialog.item} />;
    case "move":
      return <MoveDialog items={activeDialog.items} />;
    case "dirPermission":
      return <DirPermissionDialog dir={activeDialog.dir} />;
    default:
      return null;
  }
}
