import { useState } from "react";

import { select_users_modal } from "../../select_users_modal";
import { showPromptDialog } from "../../../js/dialogs";
import { TablePagination, usePagedRows } from "../../shared/TablePagination";
import { useAdaptivePageSize } from "../../shared/useAdaptivePageSize";
import type { DepartmentRecord, UserRecord } from "./types";
import { UserCard } from "./view/UserCard";
import * as styles from "./view/styles";

export type DepartmentsViewProps = {
  isMobile: boolean;
  departments: DepartmentRecord[];
  selectedDepartmentId: number | null;
  selectedDepartment: DepartmentRecord | null;
  departmentUsers: UserRecord[];
  loading: boolean;
  onRefresh: () => void;
  onSelectDept: (departmentId: number) => void;
  onCreateDept: (name: string) => void;
  onRenameDept: (departmentId: number, name: string) => void;
  onDeleteDept: (departmentId: number) => void;
  onOpenPermissionEditor: () => void;
  onAttachUser: (departmentId: number, userId: number) => Promise<void> | void;
  onDetachUser: (departmentId: number, userId: number) => Promise<void> | void;
};

export function DepartmentsView(props: DepartmentsViewProps) {
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const selectedDepartment = props.selectedDepartment;

  const { ref: gridRef, pageSize } = useAdaptivePageSize<HTMLDivElement>({
    minCardWidth: 260,
    gap: 8,
    ratio: 2,
  });
  const { page, setPage, totalPages, total, pageRows } = usePagedRows(
    props.departmentUsers,
    pageSize,
    props.selectedDepartmentId,
  );

  async function handleRename() {
    if (!selectedDepartment) {
      return;
    }
    const currentName = selectedDepartment.name || "";
    const nextName = await showPromptDialog({
      title: "部门改名",
      message: "请输入新的部门名称",
      initialValue: currentName,
      placeholder: "部门名称",
    });
    if (nextName === null) {
      return;
    }
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === currentName) {
      return;
    }
    props.onRenameDept(selectedDepartment.id, trimmed);
  }

  async function handleAddMembers() {
    if (!selectedDepartment) {
      return;
    }
    // 把现有成员传给选人弹窗，已加入的会被禁用，避免重复添加。
    const existingIds = props.departmentUsers.map((user) => user.id);
    const ids = await select_users_modal(Infinity, existingIds);
    if (!ids.length) {
      return;
    }
    const existing = new Set(existingIds);
    for (const id of ids) {
      if (existing.has(id)) {
        continue;
      }
      await props.onAttachUser(selectedDepartment.id, id);
    }
  }

  return (
    <div style={styles.layoutStyle(props.isMobile)}>
      <section style={styles.departmentPanelStyle(props.isMobile)}>
        <div style={styles.panelHeaderStyle}>
          <div>
            <div style={styles.sectionEyebrowStyle}>CRM / 部门</div>
            <h4 style={styles.sectionTitleStyle}>
              部门 · {props.departments.length}
            </h4>
          </div>
          <button
            type="button"
            style={styles.secondaryButtonStyle}
            onClick={props.onRefresh}
          >
            刷新
          </button>
        </div>

        <div style={styles.createRowStyle(props.isMobile)}>
          <input
            style={styles.inputStyle}
            value={newDepartmentName}
            placeholder="新部门名称"
            onChange={(event) => setNewDepartmentName(event.target.value)}
          />
          <button
            type="button"
            style={styles.primaryButtonStyle}
            onClick={() => {
              const trimmed = newDepartmentName.trim();
              if (!trimmed) {
                return;
              }
              props.onCreateDept(trimmed);
              setNewDepartmentName("");
            }}
          >
            新建
          </button>
        </div>

        <div style={styles.departmentListStyle}>
          {props.departments.map((department) => (
            <button
              key={department.id}
              type="button"
              style={styles.departmentCardStyle(
                props.selectedDepartmentId === department.id,
              )}
              onClick={() => props.onSelectDept(department.id)}
            >
              <div style={styles.departmentTitleStyle}>{department.name}</div>
              <div style={styles.departmentMetaStyle}>
                {(department.permissions || []).length} 个权限
              </div>
            </button>
          ))}
        </div>
      </section>

      <section style={styles.departmentUsersPanelStyle}>
        <div style={styles.panelHeaderStyle}>
          <div>
            <div style={styles.sectionEyebrowStyle}>Department Users</div>
            <h4 style={styles.sectionTitleStyle}>
              {selectedDepartment?.name || "未选择部门"}
            </h4>
            {selectedDepartment ? (
              <div style={styles.departmentMetaStyle}>
                {(selectedDepartment.permissions || []).length} 个权限 ·{" "}
                {props.departmentUsers.length} 名成员
              </div>
            ) : null}
          </div>
          {selectedDepartment ? (
            <div style={styles.toolbarStyle(props.isMobile)}>
              <button
                type="button"
                style={styles.secondaryButtonStyle}
                onClick={() => void handleRename()}
              >
                改名
              </button>
              <button
                type="button"
                style={styles.secondaryButtonStyle}
                onClick={props.onOpenPermissionEditor}
              >
                权限
              </button>
              <button
                type="button"
                style={styles.primaryButtonStyle}
                onClick={() => void handleAddMembers()}
              >
                加入成员
              </button>
              {selectedDepartment.id !== 1 ? (
                <button
                  type="button"
                  style={styles.dangerButtonStyle}
                  onClick={() => props.onDeleteDept(selectedDepartment.id)}
                >
                  删除部门
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {!selectedDepartment ? (
          <div style={styles.placeholderStyle}>请选择左侧部门</div>
        ) : null}
        {selectedDepartment && props.loading ? (
          <div style={styles.placeholderStyle}>读取中…</div>
        ) : null}
        {selectedDepartment && !props.loading && !props.departmentUsers.length ? (
          <div style={styles.placeholderStyle}>该部门暂无成员</div>
        ) : null}

        {selectedDepartment && props.departmentUsers.length ? (
          <TablePagination
            page={page}
            totalPages={totalPages}
            total={total}
            onPage={setPage}
          />
        ) : null}

        <div ref={gridRef} style={styles.cardGridStyle}>
          {selectedDepartment
            ? pageRows.map((user) => (
                <UserCard
                  key={user.id}
                  user={user}
                  showDepartments
                  actionLabel="移出"
                  actionTone="danger"
                  onAction={() =>
                    void props.onDetachUser(selectedDepartment.id, user.id)
                  }
                />
              ))
            : null}
        </div>
      </section>
    </div>
  );
}
