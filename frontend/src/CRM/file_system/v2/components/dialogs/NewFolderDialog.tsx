import { useState } from "react";

import { useFsActions, useFsState } from "../../context";
import { dialogInputStyle, dialogLabelStyle } from "../../styles";
import { DialogShell } from "./DialogShell";

export function NewFolderDialog() {
  const { currentPath } = useFsState();
  const actions = useFsActions();
  const [name, setName] = useState("");
  const submit = () => void actions.submitNewFolder(name.trim());

  return (
    <DialogShell title="新建文件夹" onClose={actions.closeDialog} onConfirm={submit} confirmDisabled={!name.trim()}>
      <label style={dialogLabelStyle}>
        在 {currentPath === "/" ? "根目录" : currentPath} 下创建
        <input
          style={dialogInputStyle}
          value={name}
          placeholder="文件夹名称"
          autoFocus
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim()) submit();
          }}
        />
      </label>
    </DialogShell>
  );
}
