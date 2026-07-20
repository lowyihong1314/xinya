import { useCallback, useEffect, useMemo, useState } from "react";

import { useUserState } from "../../../../app/UserState";
import { AccountsTab } from "./AccountsTab";
import { CashBookTab } from "./CashBookTab";
import { fetchGLDashboard, fetchGLJournalEntries } from "./api";
import { GL_TABLE_CSS, emptyStyle, noticeErrorStyle, noticeSuccessStyle, panelStyle } from "./glStyles";
import { JournalTab } from "./JournalTab";
import { ReportsTab } from "./ReportsTab";
import type { GLDashboard, GLJournalEntry } from "./types";

export type GLView = "journal" | "cash" | "accounts" | "reports";

type PermissionUser = {
  departments?: Array<{ permissions?: Array<{ name?: string | null } | null> | null } | null> | null;
} | null;

export function LedgerWorkspace({ view }: { view: GLView }) {
  const { user } = useUserState();
  const permissionUser = user as PermissionUser;

  const [dashboard, setDashboard] = useState<GLDashboard | null>(null);
  const [entries, setEntries] = useState<GLJournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canEdit = useMemo(() => {
    const names = new Set<string>();
    for (const department of permissionUser?.departments || []) {
      for (const permission of department?.permissions || []) {
        if (permission?.name) names.add(permission.name);
      }
    }
    return names.has("account_edit");
  }, [permissionUser]);

  const notify = useCallback((text: string, isError = false) => {
    if (isError) {
      setError(text);
      setMessage(null);
    } else {
      setMessage(text);
      setError(null);
    }
  }, []);

  useEffect(() => {
    if (!message && !error) return;
    const timer = window.setTimeout(() => {
      setMessage(null);
      setError(null);
    }, 3600);
    return () => window.clearTimeout(timer);
  }, [message, error]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchGLDashboard();
      setDashboard(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "总账模块载入失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEntries = useCallback(async () => {
    setLoadingEntries(true);
    try {
      const data = await fetchGLJournalEntries();
      setEntries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "载入凭证失败");
    } finally {
      setLoadingEntries(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
    if (view === "journal") void loadEntries();
  }, [loadDashboard, loadEntries, view]);

  const refreshAll = useCallback(async () => {
    await loadDashboard();
    if (view === "journal") await loadEntries();
  }, [loadDashboard, loadEntries, view]);

  if (loading && !dashboard) {
    return <div style={emptyStyle}>总账模块载入中…</div>;
  }

  if (!dashboard) {
    return <div style={noticeErrorStyle}>{error || "总账模块暂时不可用"}</div>;
  }

  return (
    <section style={panelStyle}>
      <style>{GL_TABLE_CSS}</style>

      {message ? <div style={noticeSuccessStyle}>{message}</div> : null}
      {error ? <div style={noticeErrorStyle}>{error}</div> : null}

      {view === "journal" ? (
        <JournalTab
          entries={entries}
          accounts={dashboard.accounts}
          canEdit={canEdit}
          loading={loadingEntries}
          onChanged={() => void refreshAll()}
          onNotify={notify}
        />
      ) : null}

      {view === "cash" ? <CashBookTab cash={dashboard.cash} onNotify={notify} /> : null}

      {view === "accounts" ? (
        <AccountsTab accounts={dashboard.accounts} canEdit={canEdit} onChanged={() => void loadDashboard()} onNotify={notify} />
      ) : null}

      {view === "reports" ? <ReportsTab accounts={dashboard.accounts} onNotify={notify} /> : null}
    </section>
  );
}
