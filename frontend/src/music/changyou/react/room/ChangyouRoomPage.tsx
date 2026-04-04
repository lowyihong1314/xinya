import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ensureDesignTokens } from "../../../../theme/designTokens";
import { CHANGYOU_PATH, getChangyouRoomPath } from "../../../router/paths";
import { createChangyouRoom, fetchChangyouRooms, type ChangyouRoom } from "./api";
import { ChangyouRoomController } from "./ChangyouRoomController";

export function ChangyouRoomPage() {
  ensureDesignTokens();

  const navigate = useNavigate();
  const { roomId } = useParams();

  const [topic, setTopic] = useState("");
  const [rooms, setRooms] = useState<ChangyouRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (roomId) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    fetchChangyouRooms()
      .then((response) => {
        if (!cancelled) {
          setRooms(response.rooms || []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载房间失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [roomId]);

  async function handleCreateRoom() {
    if (!topic.trim()) return;
    setCreating(true);
    setError("");

    try {
      const response = await createChangyouRoom(topic.trim());
      navigate(getChangyouRoomPath(response.room.room_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建房间失败");
    } finally {
      setCreating(false);
    }
  }

  if (roomId) {
    return <ChangyouRoomController roomId={roomId} />;
  }

  return (
    <div style={pageStyle}>
      <div style={pageInnerStyle}>
        <div style={topBarStyle}>
          <button type="button" onClick={() => navigate(CHANGYOU_PATH)} style={backButtonStyle}>
            ← 返回唱游歌簿
          </button>
        </div>

        <section style={heroCardStyle}>
          <h1 style={titleStyle}>唱游房间控制台</h1>
          <p style={subtitleStyle}>
            这里负责创建房间和进入控制面板。公开播放页走独立 HTML，控制逻辑全部在
            `/music/changyou/room/:roomId`。
          </p>
        </section>

        <section style={createCardStyle}>
          <input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="输入房间主题"
            style={inputStyle}
          />
          <button
            type="button"
            onClick={() => void handleCreateRoom()}
            style={primaryButtonStyle}
            disabled={creating || !topic.trim()}
          >
            {creating ? "创建中..." : "创建房间"}
          </button>
        </section>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <section style={listCardStyle}>
          <div style={sectionTitleStyle}>全部房间</div>
          {loading ? <div style={stateStyle}>加载房间中…</div> : null}
          {!loading && rooms.length === 0 ? <div style={emptyCardStyle}>还没有房间。</div> : null}
          {!loading && rooms.length > 0 ? (
            <div style={roomListStyle}>
              {rooms.map((item) => (
                <button
                  key={item.room_id}
                  type="button"
                  onClick={() => navigate(getChangyouRoomPath(item.room_id))}
                  style={roomItemStyle}
                >
                  <div style={roomTitleStyle}>{item.topic}</div>
                  <div style={roomMetaStyle}>
                    创建者：{item.creator_name || "-"} · 房间码：{item.room_id}
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  padding: "20px",
  background:
    "radial-gradient(circle at top left, rgba(15,118,110,0.12), transparent 22%), linear-gradient(180deg, var(--x-color-canvas), var(--x-color-canvas-alt))",
  boxSizing: "border-box",
};

const pageInnerStyle: CSSProperties = {
  width: "100%",
  maxWidth: "1100px",
  margin: "0 auto",
  display: "grid",
  gap: "18px",
};

const topBarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-start",
};

const backButtonStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 800,
  cursor: "pointer",
};

const heroCardStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "24px",
  border: "1px solid var(--x-color-line-soft)",
  background: "linear-gradient(145deg, rgba(255,255,255,0.92), rgba(240,248,255,0.84))",
  boxShadow: "0 18px 36px var(--x-color-shadow-soft)",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "34px",
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

const subtitleStyle: CSSProperties = {
  margin: "10px 0 0",
  color: "var(--x-color-ink-muted)",
  lineHeight: 1.8,
};

const createCardStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: "12px",
  padding: "18px",
  borderRadius: "20px",
  background: "var(--x-color-panel-strongest)",
  border: "1px solid var(--x-color-line-soft)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  padding: "13px 16px",
  borderRadius: "14px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  boxSizing: "border-box",
};

const primaryButtonStyle: CSSProperties = {
  padding: "13px 18px",
  borderRadius: "14px",
  border: "none",
  background: "linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};

const listCardStyle: CSSProperties = {
  padding: "18px",
  borderRadius: "20px",
  background: "var(--x-color-panel-strongest)",
  border: "1px solid var(--x-color-line-soft)",
  display: "grid",
  gap: "14px",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

const roomListStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

const roomItemStyle: CSSProperties = {
  padding: "18px",
  borderRadius: "18px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel-strong)",
  textAlign: "left",
  cursor: "pointer",
};

const roomTitleStyle: CSSProperties = {
  fontWeight: 900,
  color: "var(--x-color-ink)",
};

const roomMetaStyle: CSSProperties = {
  marginTop: "6px",
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
  lineHeight: 1.7,
};

const stateStyle: CSSProperties = {
  minHeight: "240px",
  display: "grid",
  placeItems: "center",
  color: "var(--x-color-ink-muted)",
  textAlign: "center",
};

const emptyCardStyle: CSSProperties = {
  minHeight: "120px",
  display: "grid",
  placeItems: "center",
  borderRadius: "16px",
  border: "1px dashed var(--x-color-line)",
  color: "var(--x-color-ink-muted)",
  textAlign: "center",
  padding: "18px",
};

const errorStyle: CSSProperties = {
  padding: "14px 16px",
  borderRadius: "14px",
  background: "rgba(180,35,24,0.1)",
  border: "1px solid rgba(180,35,24,0.22)",
  color: "#b42318",
};
