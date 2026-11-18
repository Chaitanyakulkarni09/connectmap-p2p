import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAllDownloads, listTorrents, listFiles, getStats, deleteTorrent, deleteFile,
  formatSpeed, formatBytes, formatETA, getDownloadUrl, getFileDownloadUrl,
  getFileExtIcon, CATEGORY_DISPLAY, CATEGORY_ICONS,
} from '../services/api';

export default function Dashboard() {
  const [transfers, setTransfers]         = useState([]);
  const [recentTorrents, setRecentTorrents] = useState([]);
  const [recentFiles, setRecentFiles]     = useState([]);
  const [stats, setStats] = useState({
    totalDl: 0, totalUl: 0,
    activePeers: 0, activeSwarms: 0,
    totalTorrents: 0, totalFiles: 0, totalDataSize: 0,
  });
  const [clientOnline, setClientOnline] = useState(false);
  const [statsLoaded, setStatsLoaded]   = useState(false);
  const navigate = useNavigate();

  // ── fetch DB stats ────────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    try {
      const data = await getStats();
      setStats((prev) => ({
        ...prev,
        totalTorrents: data.totalTorrents ?? 0,
        totalFiles:    data.totalFiles    ?? 0,
        totalDataSize: data.totalDataSize ?? 0,
        activePeers:   data.activePeers   ?? 0,
        activeSwarms:  data.activeSwarms  ?? 0,
      }));
      setStatsLoaded(true);
    } catch { /* backend unreachable */ }
  }, []);

  useEffect(() => {
    listTorrents(1, 8).then((d) => setRecentTorrents(d.results || [])).catch(() => {});
    listFiles(1, 8).then((d)    => setRecentFiles(d.results   || [])).catch(() => {});
    fetchStats();
    const t = setInterval(fetchStats, 10_000);
    return () => clearInterval(t);
  }, [fetchStats]);

  // ── poll Python client ────────────────────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      const { online, downloads } = await getAllDownloads();
      setClientOnline(online);
      if (online && downloads.length > 0) {
        setTransfers(downloads.map((d) => ({
          id:       d.info_hash,
          name:     d.name || d.info_hash,
          hash:     d.info_hash?.slice(0, 4) + '...' + d.info_hash?.slice(36),
          size:     formatBytes(d.total_size || 0),
          progress: (d.progress || 0) * 100,
          dlSpeed:  formatSpeed(d.download_rate || 0),
          ulSpeed:  formatSpeed(d.upload_rate  || 0),
          peers:    d.num_peers || 0,
          eta:      d.eta_seconds ? formatETA(d.eta_seconds) : null,
          state:    d.state || 'downloading',
          ratio:    d.ratio || 0,
        })));
        const totalDl    = downloads.reduce((s, d) => s + (d.download_rate || 0), 0);
        const totalUl    = downloads.reduce((s, d) => s + (d.upload_rate  || 0), 0);
        setStats((prev) => ({ ...prev, totalDl, totalUl }));
      } else {
        setTransfers([]);
        setStats((prev) => ({ ...prev, totalDl: 0, totalUl: 0 }));
      }
    };
    poll();
    const t = setInterval(poll, 3_000);
    return () => clearInterval(t);
  }, []);

  const handleRemoveTorrent = async (e, id) => {
    e.stopPropagation();
    try { await deleteTorrent(id); setRecentTorrents((p) => p.filter((t) => t._id !== id)); fetchStats(); } catch { /* ignore */ }
  };
  const handleRemoveFile = async (e, id) => {
    e.stopPropagation();
    try { await deleteFile(id); setRecentFiles((p) => p.filter((f) => f._id !== id)); fetchStats(); } catch { /* ignore */ }
  };

  const allItems = [
    ...recentTorrents.map((t) => ({ ...t, _type: 'torrent' })),
    ...recentFiles.map((f)    => ({ ...f, _type: 'file', name: f.originalName || f.name })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 12);

  const totalItems    = stats.totalTorrents + stats.totalFiles;
  const totalDlMB     = (stats.totalDl / (1024 * 1024)).toFixed(1);
  const totalUlMB     = (stats.totalUl / (1024 * 1024)).toFixed(1);
  const activeCount   = transfers.filter((t) => t.state !== 'seeding').length;
  const seedingCount  = transfers.filter((t) => t.state === 'seeding').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* ── Hero Stats ─────────────────────────────────────────────────────── */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>

        {/* Download speed — only meaningful when client is active */}
        <div className="stat-card stat-card--primary">
          <p className="stat-card__label">Download Speed</p>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="stat-card__value stat-card__value--green">
              {clientOnline && stats.totalDl > 0 ? totalDlMB : '—'}
            </span>
            {clientOnline && stats.totalDl > 0 && <span className="stat-card__unit">MB/s</span>}
          </div>
          <p style={{ fontSize: 9, color: '#6b7280', marginTop: 4 }}>
            {clientOnline
              ? (activeCount > 0 ? `${activeCount} downloading` : seedingCount > 0 ? `${seedingCount} seeding` : 'Client online, idle')
              : 'Start status_server.py to track'}
          </p>
        </div>

        {/* Upload speed */}
        <div className="stat-card stat-card--secondary">
          <p className="stat-card__label">Upload Speed</p>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="stat-card__value stat-card__value--blue">
              {clientOnline && stats.totalUl > 0 ? totalUlMB : '—'}
            </span>
            {clientOnline && stats.totalUl > 0 && <span className="stat-card__unit">MB/s</span>}
          </div>
          <p style={{ fontSize: 9, color: '#6b7280', marginTop: 4 }}>
            {clientOnline
              ? (seedingCount > 0 ? `${seedingCount} seeding` : 'No active uploads')
              : 'No seeding'}
          </p>
        </div>

        {/* Indexed items — always real */}
        <div className="stat-card">
          <p className="stat-card__label">Indexed Items</p>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="stat-card__value stat-card__value--white">
              {statsLoaded ? totalItems : '…'}
            </span>
            <span className="stat-card__unit">Total</span>
          </div>
          <p style={{ fontSize: 9, color: '#6b7280', marginTop: 4 }}>
            {stats.totalTorrents} torrent{stats.totalTorrents !== 1 ? 's' : ''} · {stats.totalFiles} file{stats.totalFiles !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Client status */}
        <div className="stat-card">
          <p className="stat-card__label">Client Status</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <span
              style={{ width: 8, height: 8, borderRadius: '50%', background: clientOnline ? 'var(--primary-container)' : '#6b7280' }}
              className={clientOnline ? 'animate-pulse' : ''}
            />
            <span style={{ fontFamily: 'var(--font-headline)', fontSize: 14, fontWeight: 900, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
              {clientOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          <p style={{ fontSize: 9, color: '#6b7280', marginTop: 6 }}>
            {clientOnline
              ? `${transfers.length} transfer${transfers.length !== 1 ? 's' : ''} tracked`
              : 'python client/status_server.py'}
          </p>
        </div>
      </section>

      {/* ── Active Transfers ──────────────────────────────────────────────── */}
      {transfers.length > 0 ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 className="section-title">Active Transfers</h3>
            <span className="badge badge--green">{transfers.length} Active</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {transfers.map((t, idx) => (
              <div key={t.id} style={{
                display: 'grid', gridTemplateColumns: '4fr 3fr 1fr 1fr 1fr',
                alignItems: 'center', padding: 16,
                background: idx % 2 === 0 ? 'var(--surface-low)' : 'var(--surface-container)',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', paddingRight: 16 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                  <span style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', marginTop: 2 }}>HASH: {t.hash} | {t.size}</span>
                </div>
                <div style={{ padding: '0 16px' }}>
                  <div className="progress-bar"><div className="progress-bar__fill" style={{ width: `${t.progress}%` }} /></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary-container)', textTransform: 'uppercase' }}>
                      {t.state === 'seeding' ? 'Seeding' : `${t.progress.toFixed(1)}%`}
                    </span>
                    <span style={{ fontSize: 10, color: '#6b7280' }}>{t.state === 'seeding' ? `Ratio: ${t.ratio}` : `ETA: ${t.eta || '∞'}`}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary-container)', display: 'block' }}>{t.dlSpeed}</span>
                  <span style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase' }}>Down</span>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--secondary-container)', display: 'block' }}>{t.ulSpeed}</span>
                  <span style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase' }}>Up</span>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, display: 'block' }}>{t.peers}</span>
                  <span style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase' }}>Peers</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section style={{
          background: 'var(--surface-low)', padding: '20px 24px',
          borderLeft: '2px solid rgba(60,75,53,0.3)',
          display: 'flex', alignItems: 'flex-start', gap: 16,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 28, color: '#4b5563', marginTop: 2, flexShrink: 0 }}>
            {clientOnline ? 'cloud_sync' : 'cloud_off'}
          </span>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#9ca3af', marginBottom: 6 }}>
              {clientOnline ? 'Client online — no active downloads' : 'No Active Transfers'}
            </p>
            <p style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.7 }}>
              {clientOnline
                ? 'Upload a .torrent file and start a download — progress will appear here in real time.'
                : 'Download & upload speeds show live data from the Python torrent client. Run '}{!clientOnline && <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 6px', borderRadius: 3, fontSize: 10 }}>python client/status_server.py</code>}{!clientOnline && ' in a terminal to enable live tracking.'}
            </p>
          </div>
        </section>
      )}

      {/* ── Indexed Files & Torrents ──────────────────────────────────────── */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 className="section-title">Indexed Files & Torrents</h3>
          <button className="btn-ghost" onClick={() => navigate('/')}>View All →</button>
        </div>

        {allItems.length === 0 ? (
          <div style={{ background: 'var(--surface-low)', padding: 32, textAlign: 'center' }}>
            <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#6b7280' }}>
              No files uploaded yet. Click "Upload File" to get started.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '5fr 2fr 2fr 1fr 2fr',
              padding: '12px 16px', fontSize: 9, fontWeight: 900,
              textTransform: 'uppercase', letterSpacing: '0.15em',
              color: '#6b7280', background: 'rgba(28,27,27,0.5)',
              borderBottom: '1px solid rgba(60,75,53,0.1)',
            }}>
              <div>Name</div>
              <div style={{ textAlign: 'right' }}>Size</div>
              <div style={{ textAlign: 'right' }}>Type</div>
              <div style={{ textAlign: 'right' }}>Files</div>
              <div style={{ textAlign: 'right' }}>Actions</div>
            </div>
            {allItems.map((item) => (
              <div
                key={item._id}
                style={{
                  display: 'grid', gridTemplateColumns: '5fr 2fr 2fr 1fr 2fr',
                  padding: '12px 16px', alignItems: 'center',
                  background: 'var(--surface-low)', borderLeft: '2px solid transparent',
                  cursor: item._type === 'torrent' ? 'pointer' : 'default',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => item._type === 'torrent' && navigate(`/torrent/${item._id}`)}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-container)'; e.currentTarget.style.borderLeftColor = 'var(--primary-container)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-low)'; e.currentTarget.style.borderLeftColor = 'transparent'; }}
              >
                <div style={{ overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: item._type === 'file' ? 'var(--secondary)' : 'var(--primary-container)', flexShrink: 0 }}>
                    {item._type === 'file' ? getFileExtIcon(item.name).icon : (CATEGORY_ICONS[item.category] || 'folder_zip')}
                  </span>
                  <div style={{ overflow: 'hidden' }}>
                    <p style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</p>
                    <p style={{ fontSize: 9, color: '#6b7280', fontFamily: 'monospace', marginTop: 2 }}>
                      {item._type === 'torrent' ? item.infoHash?.substring(0, 12) + '...' : item.mimetype || 'file'}
                    </p>
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 11, fontFamily: 'monospace', color: '#9ca3af' }}>
                  {formatBytes(item.totalSize || item.size || 0)}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className={`badge ${item._type === 'torrent' ? 'badge--green' : 'badge--blue'}`} style={{ fontSize: 8 }}>
                    {item._type === 'torrent' ? (CATEGORY_DISPLAY[item.category] || item.category) : 'File'}
                  </span>
                </div>
                <div style={{ textAlign: 'right', fontSize: 11, fontFamily: 'monospace', color: '#9ca3af' }}>
                  {item._type === 'torrent' ? (item.files?.length || 0) : '—'}
                </div>
                <div style={{ textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button
                    style={{ padding: 4, color: 'var(--primary-container)' }}
                    onClick={(e) => { e.stopPropagation(); window.open(item._type === 'file' ? getFileDownloadUrl(item._id) : getDownloadUrl(item._id), '_blank'); }}
                    title="Download"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
                  </button>
                  <button
                    style={{ padding: 4, color: '#6b7280', transition: 'color 0.15s ease' }}
                    onClick={(e) => item._type === 'torrent' ? handleRemoveTorrent(e, item._id) : handleRemoveFile(e, item._id)}
                    onMouseEnter={(e) => e.currentTarget.style.color = 'var(--error)'}
                    onMouseLeave={(e) => e.currentTarget.style.color = '#6b7280'}
                    title="Delete"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Stats Summary ─────────────────────────────────────────────────── */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        <div style={{ background: 'var(--surface-low)', padding: 20, borderRadius: 2 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 4 }}>
            Total Data Indexed
          </p>
          <p style={{ fontFamily: 'var(--font-headline)', fontSize: '1.5rem', fontWeight: 900, letterSpacing: '-0.05em', color: 'var(--primary-container)' }}>
            {statsLoaded ? formatBytes(stats.totalDataSize) : '…'}
          </p>
          <p style={{ fontSize: 9, color: '#6b7280', marginTop: 4 }}>across {totalItems} item{totalItems !== 1 ? 's' : ''}</p>
        </div>

        <div style={{ background: 'var(--surface-low)', padding: 20, borderRadius: 2 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 4 }}>
            Torrents / Files
          </p>
          <p style={{ fontFamily: 'var(--font-headline)', fontSize: '1.5rem', fontWeight: 900, letterSpacing: '-0.05em', color: 'var(--secondary-container)' }}>
            {stats.totalTorrents} / {stats.totalFiles}
          </p>
          <p style={{ fontSize: 9, color: '#6b7280', marginTop: 4 }}>
            {stats.totalTorrents === 0 ? 'Upload a .torrent to add one' : `${stats.totalTorrents} torrent${stats.totalTorrents !== 1 ? 's' : ''} indexed`}
          </p>
        </div>

        <div style={{ background: 'var(--surface-low)', padding: 20, borderRadius: 2 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 4 }}>
            Network Peers
          </p>
          <p style={{ fontFamily: 'var(--font-headline)', fontSize: '1.5rem', fontWeight: 900, letterSpacing: '-0.05em' }}>
            {stats.activePeers > 0 ? stats.activePeers : '—'}
          </p>
          <p style={{ fontSize: 9, color: '#6b7280', marginTop: 4 }}>
            {stats.activePeers > 0
              ? `${stats.activeSwarms} swarm${stats.activeSwarms !== 1 ? 's' : ''} active`
              : 'Peers join when clients download'}
          </p>
        </div>
      </section>
    </div>
  );
}
