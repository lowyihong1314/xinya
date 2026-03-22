import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { useNavigate, useParams } from 'react-router-dom';

import { useUserState } from '../../../app/UserState';
import { ensureDesignTokens } from '../../../theme/designTokens';
import { fetchSongbookEntries, fetchSongbookEntry } from '../api';
import type { SongbookEntry } from '../types';
import { connectChangyouRoom } from './socket';
import { createChangyouRoom, fetchChangyouRoom, fetchChangyouRoomCurrent, fetchChangyouRooms, pushChangyouRoomSong, type ChangyouRoom } from './api';

export function ChangyouRoomPage() {
  ensureDesignTokens();

  const navigate = useNavigate();
  const { roomId } = useParams();
  const { isAuthenticated, loadingUser, openLogin } = useUserState();
  const [topic, setTopic] = useState('');
  const [rooms, setRooms] = useState<ChangyouRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [room, setRoom] = useState<ChangyouRoom | null>(null);
  const [entry, setEntry] = useState<SongbookEntry | null>(null);
  const [entries, setEntries] = useState<SongbookEntry[]>([]);
  const [selectedSongId, setSelectedSongId] = useState<number | null>(null);
  const [selectedVersionUserId, setSelectedVersionUserId] = useState<number | null>(null);
  const [selectedVersionKind, setSelectedVersionKind] = useState<'base' | 'user'>('base');
  const [pushing, setPushing] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    if (!loadingUser && !isAuthenticated && !roomId) {
      openLogin();
    }
  }, [loadingUser, isAuthenticated, openLogin, roomId]);

  useEffect(() => {
    if (roomId) return;
    let cancelled = false;
    setLoading(true);
    fetchChangyouRooms()
      .then((response) => !cancelled && setRooms(response.rooms || []))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : '加载房间失败'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchChangyouRoom(roomId), fetchChangyouRoomCurrent(roomId)])
      .then(async ([roomRes, currentRes]) => {
        if (cancelled) return;
        setRoom(roomRes.room);
        setEntry(currentRes.entry || null);
        if (roomRes.room.role === 'controller') {
          const listRes = await fetchSongbookEntries('', '');
          if (!cancelled) {
            setEntries(listRes.entries || []);
            setSelectedSongId(currentRes.room.song_entry_id || currentRes.entry?.id || null);
            setSelectedVersionKind((currentRes.room.version_kind as 'base' | 'user') || 'base');
            setSelectedVersionUserId(currentRes.room.editor_user_id || null);
          }
        }
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : '加载房间失败'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    const socket = connectChangyouRoom(roomId);
    socket.on('changyou_room_update', (payload) => {
      setRoom((current) => current ? { ...current, ...payload.room } : current);
      setEntry(payload.entry || null);
      setSelectedSongId(payload.room?.song_entry_id || payload.entry?.id || null);
      setSelectedVersionKind((payload.room?.version_kind as 'base' | 'user') || 'base');
      setSelectedVersionUserId(payload.room?.editor_user_id || null);
    });
    return () => {
      socket.disconnect();
    };
  }, [roomId]);

  useEffect(() => {
    if (!roomId || !room) return;
    const absolute = `${window.location.origin}/#${`/changyou-room/${roomId}`}`;
    QRCode.toDataURL(absolute).then(setQrDataUrl).catch(() => setQrDataUrl(''));
  }, [roomId, room]);

  const selectedSong = useMemo(() => entries.find((item) => item.id === selectedSongId) || null, [entries, selectedSongId]);

  useEffect(() => {
    if (!selectedSong || selectedVersionKind !== 'user') return;
    fetchSongbookEntry(selectedSong.id).then((response) => {
      const versions = response.entry.versions || [];
      const fallback = versions.find((item) => item.kind === 'user');
      if (!selectedVersionUserId && fallback?.user_id) {
        setSelectedVersionUserId(fallback.user_id);
      }
    }).catch(() => {});
  }, [selectedSong, selectedVersionKind, selectedVersionUserId]);

  async function handleCreateRoom() {
    if (!topic.trim()) return;
    setCreating(true);
    setError('');
    try {
      const response = await createChangyouRoom(topic.trim());
      navigate(`/changyou-room/${response.room.room_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建房间失败');
    } finally {
      setCreating(false);
    }
  }

  async function handlePushSong() {
    if (!roomId || !selectedSongId) return;
    setPushing(true);
    setError('');
    try {
      const current = await pushChangyouRoomSong(roomId, {
        song_entry_id: selectedSongId,
        version_kind: selectedVersionKind,
        editor_user_id: selectedVersionKind === 'user' ? selectedVersionUserId : null,
      });
      setRoom(current.room);
      setEntry(current.entry || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '投放失败');
    } finally {
      setPushing(false);
    }
  }

  if (loadingUser) return <div style={stateStyle}>加载中…</div>;

  if (!roomId) {
    if (!isAuthenticated) return <div style={stateStyle}>请先登录后创建房间。</div>;
    return (
      <div style={pageStyle}>
        <div style={topBarStyle}>
          <button type="button" onClick={() => navigate('/changyou')} style={backButtonStyle}>← 返回唱游歌簿</button>
        </div>
        <div style={heroStyle}>
          <h1 style={titleStyle}>唱游房间</h1>
          <p style={subtitleStyle}>创建一个房间，或进入现有房间。</p>
        </div>
        <div style={createCardStyle}>
          <input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="输入房间主题" style={inputStyle} />
          <button type="button" onClick={() => void handleCreateRoom()} style={primaryButtonStyle} disabled={creating}>{creating ? '创建中...' : '创建房间'}</button>
        </div>
        {error ? <div style={errorStyle}>{error}</div> : null}
        <div style={sectionTitleStyle}>全部房间</div>
        <div style={roomListStyle}>
          {loading ? <div style={stateStyle}>加载房间中…</div> : null}
          {!loading && rooms.length === 0 ? <div style={emptyCardStyle}>还没有房间。</div> : null}
          {rooms.map((item) => (
            <button key={item.room_id} type="button" onClick={() => navigate(`/changyou-room/${item.room_id}`)} style={roomItemStyle}>
              <div style={roomTitleStyle}>{item.topic}</div>
              <div style={roomMetaStyle}>创建者：{item.creator_name || '-'} · 房间码：{item.room_id}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (loading) return <div style={stateStyle}>加载房间中…</div>;
  if (!room) return <div style={stateStyle}>房间不存在或已过期。</div>;

  if (room.role === 'controller') {
    return (
      <div style={pageStyle}>
        <div style={topBarStyle}>
          <button type="button" onClick={() => navigate('/changyou-room')} style={backButtonStyle}>← 返回房间列表</button>
        </div>
        <div style={heroStyle}>
          <h1 style={titleStyle}>{room.topic}</h1>
          <p style={subtitleStyle}>控制端 · 房间码 {room.room_id}</p>
        </div>
        {error ? <div style={errorStyle}>{error}</div> : null}
        <div style={gridStyle}>
          <div style={panelStyle}>
            <div style={sectionTitleStyle}>投放歌词</div>
            <select value={selectedSongId ?? ''} onChange={(event) => setSelectedSongId(event.target.value ? Number(event.target.value) : null)} style={inputStyle}>
              <option value="">选择歌曲</option>
              {entries.map((item) => <option key={item.id} value={item.id}>{item.song_number ? `${item.song_number}. ` : ''}{item.title}</option>)}
            </select>
            <select value={selectedVersionKind} onChange={(event) => setSelectedVersionKind(event.target.value as 'base' | 'user')} style={inputStyle}>
              <option value="base">原版</option>
              <option value="user">某个编辑版</option>
            </select>
            {selectedVersionKind === 'user' && selectedSong ? <UserVersionSelector songId={selectedSong.id} selectedUserId={selectedVersionUserId} onChange={setSelectedVersionUserId} /> : null}
            <button type="button" onClick={() => void handlePushSong()} style={primaryButtonStyle} disabled={pushing || !selectedSongId || (selectedVersionKind === 'user' && !selectedVersionUserId)}>{pushing ? '投放中...' : '投放到播放端'}</button>
          </div>
          <div style={panelStyle}>
            <div style={sectionTitleStyle}>播放入口</div>
            {qrDataUrl ? <img src={qrDataUrl} alt="room qr" style={qrStyle} /> : <div style={emptyCardStyle}>正在生成 QR...</div>}
            <div style={roomMetaStyle}>{window.location.origin}/#/changyou-room/{room.room_id}</div>
          </div>
        </div>
        <div style={panelStyle}>
          <div style={sectionTitleStyle}>当前投放</div>
          {!entry ? <div style={emptyCardStyle}>还没有投放歌曲。</div> : <pre style={contentStyle}>{entry.content || ''}</pre>}
        </div>
      </div>
    );
  }

  return (
    <div style={playerPageStyle}>
      <div style={playerTopBarStyle}>
        <button type="button" onClick={() => navigate('/changyou-room')} style={backButtonStyle}>← 返回</button>
      </div>
      <div style={playerTitleStyle}>{room.topic}</div>
      {!entry ? <div style={stateStyle}>等待控制端投放歌词…</div> : (
        <div style={playerCardStyle}>
          <div style={playerSongTitleStyle}>{entry.song_number ? `${entry.song_number}. ` : ''}{entry.title}</div>
          <div style={roomMetaStyle}>{entry.active_version_label || '原版'}</div>
          <pre style={playerContentStyle}>{entry.content || ''}</pre>
        </div>
      )}
    </div>
  );
}

function UserVersionSelector({ songId, selectedUserId, onChange }: { songId: number; selectedUserId: number | null; onChange: (value: number | null) => void }) {
  const [versions, setVersions] = useState<SongbookVersionOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchSongbookEntry(songId).then((response) => {
      if (!cancelled) {
        setVersions((response.entry.versions || []).filter((item) => item.kind === 'user'));
      }
    }).catch(() => {
      if (!cancelled) setVersions([]);
    });
    return () => { cancelled = true; };
  }, [songId]);

  return (
    <select value={selectedUserId ?? ''} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)} style={inputStyle}>
      <option value="">选择编辑版</option>
      {versions.map((item) => <option key={item.user_id} value={item.user_id ?? ''}>{item.label}</option>)}
    </select>
  );
}

const pageStyle = { minHeight: '100vh', padding: '20px', background: 'linear-gradient(180deg, var(--x-color-canvas), var(--x-color-canvas-alt))', boxSizing: 'border-box' as const };
const playerPageStyle = { minHeight: '100vh', padding: '20px', background: '#111827', color: 'white', boxSizing: 'border-box' as const };
const topBarStyle = { display: 'flex', justifyContent: 'flex-start', marginBottom: '20px' } as const;
const playerTopBarStyle = { display: 'flex', justifyContent: 'flex-start', marginBottom: '12px' } as const;
const backButtonStyle = { padding: '12px 16px', borderRadius: '999px', border: '1px solid var(--x-color-line)', background: 'var(--x-color-panel)', color: 'var(--x-color-ink)', fontWeight: 800, cursor: 'pointer' } as const;
const heroStyle = { marginBottom: '18px' } as const;
const titleStyle = { margin: 0, fontSize: '32px', fontWeight: 900, color: 'var(--x-color-ink)' } as const;
const subtitleStyle = { margin: '10px 0 0', color: 'var(--x-color-ink-muted)' } as const;
const createCardStyle = { display: 'flex', gap: '12px', flexWrap: 'wrap' as const, padding: '18px', borderRadius: '18px', background: 'var(--x-color-panel-strongest)', border: '1px solid var(--x-color-line-soft)', marginBottom: '18px' } as const;
const inputStyle = { width: '100%', maxWidth: '100%', padding: '13px 16px', borderRadius: '14px', border: '1px solid var(--x-color-line)', background: 'var(--x-color-panel-strongest)', boxSizing: 'border-box' as const } as const;
const primaryButtonStyle = { padding: '13px 18px', borderRadius: '14px', border: 'none', background: 'linear-gradient(135deg, var(--x-color-accent), var(--x-color-info))', color: 'white', fontWeight: 800, cursor: 'pointer' } as const;
const sectionTitleStyle = { fontSize: '18px', fontWeight: 900, color: 'var(--x-color-ink)', marginBottom: '12px' } as const;
const roomListStyle = { display: 'grid', gap: '10px' } as const;
const roomItemStyle = { padding: '16px', borderRadius: '16px', border: '1px solid var(--x-color-line-soft)', background: 'var(--x-color-panel-strong)', textAlign: 'left' as const, cursor: 'pointer' } as const;
const roomTitleStyle = { fontWeight: 800, color: 'var(--x-color-ink)' } as const;
const roomMetaStyle = { marginTop: '6px', fontSize: '12px', color: 'var(--x-color-ink-muted)' } as const;
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginBottom: '16px' } as const;
const panelStyle = { padding: '18px', borderRadius: '18px', background: 'var(--x-color-panel-strongest)', border: '1px solid var(--x-color-line-soft)', display: 'grid', gap: '12px' } as const;
const qrStyle = { width: '220px', maxWidth: '100%', borderRadius: '16px', background: 'white', padding: '10px' } as const;
const contentStyle = { margin: 0, whiteSpace: 'pre-wrap' as const, fontFamily: '"SFMono-Regular",Consolas,monospace', lineHeight: 1.8, fontSize: '15px', color: 'var(--x-color-ink)' } as const;
const playerTitleStyle = { fontSize: '28px', fontWeight: 900, marginBottom: '16px' } as const;
const playerCardStyle = { maxWidth: '980px', margin: '0 auto', padding: '24px', borderRadius: '24px', background: '#1f2937' } as const;
const playerSongTitleStyle = { fontSize: '30px', fontWeight: 900, marginBottom: '10px' } as const;
const playerContentStyle = { margin: '16px 0 0', whiteSpace: 'pre-wrap' as const, fontFamily: '"SFMono-Regular",Consolas,monospace', lineHeight: 1.9, fontSize: '18px', color: 'white' } as const;
const stateStyle = { minHeight: '240px', display: 'grid', placeItems: 'center', color: 'var(--x-color-ink-muted)' } as const;
const emptyCardStyle = { padding: '18px', borderRadius: '16px', background: 'var(--x-color-panel-strong)', color: 'var(--x-color-ink-muted)' } as const;
const errorStyle = { marginBottom: '12px', padding: '12px 14px', borderRadius: '14px', background: 'rgba(220,38,38,0.08)', color: 'var(--x-color-danger)', border: '1px solid rgba(220,38,38,0.16)' } as const;
