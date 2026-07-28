import { useState } from "react";

import { useFsActions } from "../../context";
import { dialogInputStyle, dialogLabelStyle } from "../../styles";
import type { SelectableItem } from "../../types";
import { DialogShell } from "./DialogShell";

export function RenameDialog({ item }: { item: SelectableItem }) {
  const actions = useFsActions();
  const [name, setName] = useState(item.name);
  const submit = () => void actions.submitRename(item, name.trim());

  return (
    <DialogShell title="重命名" onClose={actions.closeDialog} onConfirm={submit} confirmDisabled={!name.trim()}>
      <label style={dialogLabelStyle}>
        新名称
        <input
          style={dialogInputStyle}
          value={name}
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
