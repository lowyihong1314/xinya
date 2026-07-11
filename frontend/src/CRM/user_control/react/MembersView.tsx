import { TablePagination, usePagedRows } from "../../shared/TablePagination";
import { useAdaptivePageSize } from "../../shared/useAdaptivePageSize";
import type { UserRecord } from "./types";
import { UserCard } from "./view/UserCard";
import { UserEditorPage } from "./view/UserEditorPage";
import * as styles from "./view/styles";
import type { MemberRenewalPayload, UserEditorPayload } from "./view/types";

export type MembersViewProps = {
  isMobile: boolean;
  users: UserRecord[];
  search: string;
  loading: boolean;
  editorUserId: number | null;
  selectedUser: UserRecord | null;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onOpenNewUser: () => void;
  onOpenUser: (userId: number) => void;
  onCloseUser: () => void;
  onSaveUser: (payload: UserEditorPayload) => void;
  onDeleteUser: (userId: number) => void;
  onResetPassword: (userId: number) => void;
  onCreateRenewal: (payload: MemberRenewalPayload) => void;
  onDeleteRenewal: (renewalId: number) => void;
};

export function MembersView(props: MembersViewProps) {
  const { ref: gridRef, pageSize } = useAdaptivePageSize<HTMLDivElement>({
    minCardWidth: 260,
    gap: 8,
    ratio: 2,
  });
  const { page, setPage, totalPages, total, pageRows } = usePagedRows(
    props.users,
    pageSize,
    props.search,
  );

  if (props.editorUserId !== null) {
    const user =
      props.selectedUser && props.selectedUser.id === props.editorUserId
        ? props.selectedUser
        : null;
    return (
      <section style={styles.editorPageShellStyle}>
        {user ? (
          <UserEditorPage
            user={user}
            onBack={props.onCloseUser}
            onSave={props.onSaveUser}
            onDelete={() => props.onDeleteUser(user.id)}
            onResetPassword={() => props.onResetPassword(user.id)}
            onCreateRenewal={props.onCreateRenewal}
            onDeleteRenewal={props.onDeleteRenewal}
          />
        ) : (
          <div style={styles.editorPageStyle}>
            <div style={styles.editorPageHeaderStyle}>
              <div style={styles.sectionEyebrowStyle}>User Detail</div>
              <button
                type="button"
                style={styles.secondaryButtonStyle}
                onClick={props.onCloseUser}
              >
                返回列表
              </button>
            </div>
            <div style={styles.placeholderStyle}>读取中…</div>
          </div>
        )}
      </section>
    );
  }

  return (
    <section style={styles.panelStyle}>
      <div style={styles.panelHeaderStyle}>
        <div>
          <div style={styles.sectionEyebrowStyle}>CRM / 用户</div>
          <h4 style={styles.sectionTitleStyle}>用户管理 · 共 {props.users.length} 人</h4>
        </div>
        <div style={styles.toolbarStyle(props.isMobile)}>
          <input
            style={styles.searchStyle(props.isMobile)}
            value={props.search}
            placeholder="搜索姓名 / 用户名 / 邮箱 / 电话"
            onChange={(event) => props.onSearchChange(event.target.value)}
          />
          <button
            type="button"
            style={styles.secondaryButtonStyle}
            onClick={props.onRefresh}
          >
            刷新
          </button>
          <button
            type="button"
            style={styles.primaryButtonStyle}
            onClick={props.onOpenNewUser}
          >
            新增用户
          </button>
        </div>
      </div>

      <TablePagination
        page={page}
        totalPages={totalPages}
        total={total}
        onPage={setPage}
      />

      {props.loading ? <div style={styles.placeholderStyle}>读取中…</div> : null}
      {!props.loading && !props.users.length ? (
        <div style={styles.placeholderStyle}>没有匹配的用户</div>
      ) : null}

      <div ref={gridRef} style={styles.cardGridStyle}>
        {pageRows.map((user) => (
          <UserCard
            key={user.id}
            user={user}
            showDepartments
            onOpen={() => props.onOpenUser(user.id)}
          />
        ))}
      </div>
    </section>
  );
}
