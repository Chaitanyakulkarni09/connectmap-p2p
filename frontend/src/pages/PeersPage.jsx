import { useState, useEffect, useRef, useCallback } from 'react';
import { getTrackerStats } from '../services/api';
import axios from 'axios';

// ── helpers ──────────────────────────────────────────────────────────────────

function time() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function rndIP() {
  return `${rnd(256)}.${rnd(256)}.${rnd(256)}.${rnd(256)}`;
}

function rnd(n) { return Math.floor(Math.random() * n); }

function formatUptime(seconds) {
  if (!seconds) return '--';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// Generate a set of node positions for the mesh map
// nodeCount: how many nodes to show (clamped to 3–12)
function makeNodes(nodeCount) {
  const count = Math.max(3, Math.min(12, nodeCount));
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: 10 + rnd(80),  // 10% – 90% of container width
    y: 15 + rnd(70),  // 15% – 85% of container height
    primary: i % 3 === 0,
  }));
}

// Build edge list between nodes (sparse, not all pairs)
function makeEdges(nodes) {
  const edges = [];
  for (let i = 0; i < nodes.length; i++) {
    // connect each node to 1–2 neighbours
    const targets = new Set();
    targets.add((i + 1) % nodes.length);
    if (nodes.length > 4) targets.add((i + 2) % nodes.length);
    for (const j of targets) {
      if (i < j) edges.push([i, j]);
    }
  }
  return edges;
}

// ── component ────────────────────────────────────────────────────────────────

export default function PeersPage() {
  const [trackerStats, setTrackerStats] = useState({ totalSwarms: 0, totalPeers: 0, uptime: 0 });
  const [trackerOnline, setTrackerOnline] = useState(false);
  const [apiOnline, setApiOnline]         = useState(false);
  const [logLines, setLogLines]           = useState([]);
  const [velocityBars, setVelocityBars]   = useState(() => Array.from({ length: 10 }, () => 30 + rnd(50)));

  // mesh map state
  const [nodes, setNodes]   = useState(() => makeNodes(5));
  const [edges, setEdges]   = useState([]);
  const [flashEdge, setFlashEdge] = useState(null); // index of edge to highlight
  const mapRef = useRef(null);

  // ── derive edges whenever nodes change ───────────────────────────────────
  useEffect(() => {
    setEdges(makeEdges(nodes));
  }, [nodes]);

  // ── poll tracker + health ─────────────────────────────────────────────────
  const fetchTrackerStats = useCallback(async () => {
    try {
      const data = await getTrackerStats();
      if (data && !data.error) {
        setTrackerStats(data);
        setTrackerOnline(true);
      } else {
        setTrackerOnline(false);
      }
    } catch {
      setTrackerOnline(false);
    }
  }, []);

  const fetchApiHealth = useCallback(async () => {
    try {
      await axios.get('/api/health', { timeout: 3000 });
      setApiOnline(true);
    } catch {
      setApiOnline(false);
    }
  }, []);

  useEffect(() => {
    fetchTrackerStats();
    fetchApiHealth();
    const t = setInterval(() => { fetchTrackerStats(); fetchApiHealth(); }, 5000);
    return () => clearInterval(t);
  }, [fetchTrackerStats, fetchApiHealth]);

  // ── animate velocity bars (reflect real peer count in amplitude) ──────────
  useEffect(() => {
    const t = setInterval(() => {
      const base = trackerStats.totalPeers > 0 ? 55 : 20;
      setVelocityBars(Array.from({ length: 10 }, () => base + rnd(45)));
    }, 1200);
    return () => clearInterval(t);
  }, [trackerStats.totalPeers]);

  // ── animate mesh map: shuffle node positions + flash edges ────────────────
  useEffect(() => {
    if (!trackerOnline) return;

    // Recalculate node count from real peer data (at least 3, up to 12)
    const desiredNodes = Math.max(3, Math.min(12, (trackerStats.totalPeers || 0) + 4));

    // Gently drift node positions every 2.5 s
    const posTimer = setInterval(() => {
      setNodes((prev) => {
        // Grow/shrink to match peer count
        let next = [...prev];
        while (next.length < desiredNodes) next.push({ id: next.length, x: 10 + rnd(80), y: 15 + rnd(70), primary: next.length % 3 === 0 });
        while (next.length > desiredNodes) next.pop();
        // Drift each node a little
        return next.map((n) => ({
          ...n,
          x: Math.max(5, Math.min(93, n.x + (rnd(11) - 5))),
          y: Math.max(10, Math.min(88, n.y + (rnd(11) - 5))),
        }));
      });
    }, 2500);

    // Flash a random edge every 800 ms to simulate packet flow
    const edgeTimer = setInterval(() => {
      setEdges((prevEdges) => {
        if (prevEdges.length === 0) return prevEdges;
        setFlashEdge(rnd(prevEdges.length));
        return prevEdges;
      });
    }, 800);

    return () => { clearInterval(posTimer); clearInterval(edgeTimer); };
  }, [trackerOnline, trackerStats.totalPeers]);

  // Clear flash after a short blink
  useEffect(() => {
    if (flashEdge === null) return;
    const t = setTimeout(() => setFlashEdge(null), 350);
    return () => clearTimeout(t);
  }, [flashEdge]);

  // ── terminal log ──────────────────────────────────────────────────────────
  useEffect(() => {
    setLogLines([
      { text: `[${time()}] ENGINE: INITIALIZING PEER DISCOVERY MODULE`, color: 'green' },
      { text: `[${time()}] DHT: BOOTSTRAPPING ROUTING TABLE`, color: null },
      { text: `[${time()}] TRACKER: CONNECTING TO ${window.location.origin}`, color: null },
    ]);

    const msgs = () => [
      { text: `[${time()}] ENGINE: HEARTBEAT — ${trackerOnline ? 'TRACKER ONLINE' : 'AWAITING TRACKER'}`, color: trackerOnline ? 'green' : null },
      { text: `[${time()}] DHT: ROUTING TABLE ${trackerStats.totalPeers} NODES`, color: 'blue' },
      { text: `[${time()}] ENGINE: PACKET ${Math.random() > 0.5 ? 'IN' : 'OUT'} ${rndIP()}`, color: Math.random() > 0.7 ? 'green' : null },
      { text: `[${time()}] PEER: KEEPALIVE TO ${rndIP()}:${6000 + rnd(4000)}`, color: null },
      { text: `[${time()}] SWARM: ${trackerStats.totalSwarms} ACTIVE SWARMS MONITORED`, color: 'blue' },
      { text: `[${time()}] TRACKER: ${trackerOnline ? `${trackerStats.totalPeers} PEER(S) REGISTERED` : 'RECONNECTING...'}`, color: trackerOnline ? 'green' : null },
    ];

    const t = setInterval(() => {
      const pool = msgs();
      setLogLines((prev) => [...prev.slice(-8), pool[rnd(pool.length)]]);
    }, 2500);
    return () => clearInterval(t);
  }, [trackerOnline, trackerStats]);

  // ── SVG dimensions for the mesh map ──────────────────────────────────────
  const mapW = mapRef.current?.clientWidth  || 600;
  const mapH = mapRef.current?.clientHeight || 240;

  return (
    <div style={{
      height: 'calc(100vh - var(--topbar-height))',
      overflow: 'hidden',
      display: 'grid',
      gridTemplateColumns: '8fr 4fr',
      gap: 24,
    }}>

      {/* ── Left column ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, overflow: 'hidden' }}>

        {/* Live Mesh Map */}
        <section ref={mapRef} style={{
          height: 256,
          background: 'var(--surface-low)',
          borderRadius: 4,
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div className="dot-grid" style={{ position: 'absolute', inset: 0, opacity: 0.2, pointerEvents: 'none' }} />

          <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 20 }}>
            <h2 style={{ fontFamily: 'var(--font-headline)', fontSize: 12, fontWeight: 900, letterSpacing: '0.15em', color: 'var(--primary-container)', textTransform: 'uppercase' }}>
              Live Mesh Map
            </h2>
            <p style={{ fontSize: 10, color: '#6b7280', marginTop: 4, textTransform: 'uppercase' }}>
              {trackerOnline ? 'Global Ingress / Egress Flow' : 'Waiting for tracker connection...'}
            </p>
          </div>

          {/* SVG for animated edges + nodes */}
          <svg
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            {/* Edges */}
            {edges.map(([a, b], i) => {
              const na = nodes[a], nb = nodes[b];
              if (!na || !nb) return null;
              const flashing = i === flashEdge;
              return (
                <line
                  key={`${a}-${b}`}
                  x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                  stroke={flashing
                    ? (na.primary ? 'rgba(57,255,20,0.9)' : 'rgba(80,142,255,0.9)')
                    : (na.primary ? 'rgba(57,255,20,0.18)' : 'rgba(80,142,255,0.14)')}
                  strokeWidth={flashing ? 0.5 : 0.25}
                  style={{ transition: 'stroke 0.25s ease, stroke-width 0.25s ease' }}
                />
              );
            })}

            {/* Nodes */}
            {trackerOnline && nodes.map((n) => (
              <g key={n.id}>
                {/* outer pulse ring */}
                <circle
                  cx={n.x} cy={n.y} r={n.primary ? 2.4 : 1.8}
                  fill="none"
                  stroke={n.primary ? 'rgba(57,255,20,0.25)' : 'rgba(80,142,255,0.2)'}
                  strokeWidth={0.4}
                />
                {/* solid dot */}
                <circle
                  cx={n.x} cy={n.y} r={n.primary ? 1.3 : 0.9}
                  fill={n.primary ? 'var(--primary-container)' : 'var(--secondary-container)'}
                  style={{ transition: 'cx 1.2s ease, cy 1.2s ease' }}
                />
              </g>
            ))}
          </svg>

          {/* Legend */}
          <div style={{ position: 'absolute', bottom: 16, right: 16, display: 'flex', gap: 16, fontSize: 10, fontWeight: 700, letterSpacing: '-0.02em' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: trackerOnline ? 'var(--primary-container)' : '#6b7280' }} />
              <span style={{ textTransform: 'uppercase' }}>Tracker: {trackerOnline ? 'Online' : 'Offline'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--secondary-container)' }} />
              <span style={{ textTransform: 'uppercase' }}>
                Peers: {trackerStats.totalPeers}
                {trackerStats.totalSwarms > 0 && ` / ${trackerStats.totalSwarms} swarm${trackerStats.totalSwarms !== 1 ? 's' : ''}`}
              </span>
            </div>
          </div>
        </section>

        {/* Tracker Overview */}
        <section style={{ flex: 1, background: 'var(--surface-low)', borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(60,75,53,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontFamily: 'var(--font-headline)', fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
              Tracker Overview
            </h3>
            <span className={`badge ${trackerOnline ? 'badge--green' : 'badge--red'}`}>
              {trackerOnline ? 'CONNECTED' : 'OFFLINE'}
            </span>
          </div>

          <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              <div style={{ background: 'var(--surface-container)', padding: 16, borderRadius: 2 }}>
                <p style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 4 }}>Active Swarms</p>
                <p style={{ fontFamily: 'var(--font-headline)', fontSize: '1.5rem', fontWeight: 900, letterSpacing: '-0.05em', color: 'var(--primary-container)' }}>
                  {trackerStats.totalSwarms}
                </p>
                <p style={{ fontSize: 9, color: '#6b7280', marginTop: 4 }}>
                  {trackerStats.totalSwarms === 0
                    ? 'No clients have announced yet'
                    : `${trackerStats.totalSwarms} info-hash${trackerStats.totalSwarms !== 1 ? 'es' : ''} tracked`}
                </p>
              </div>
              <div style={{ background: 'var(--surface-container)', padding: 16, borderRadius: 2 }}>
                <p style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 4 }}>Connected Peers</p>
                <p style={{ fontFamily: 'var(--font-headline)', fontSize: '1.5rem', fontWeight: 900, letterSpacing: '-0.05em', color: 'var(--secondary-container)' }}>
                  {trackerStats.totalPeers}
                </p>
                <p style={{ fontSize: 9, color: '#6b7280', marginTop: 4 }}>
                  {trackerStats.totalPeers === 0
                    ? 'Peers appear when clients download'
                    : `${trackerStats.totalPeers} active peer${trackerStats.totalPeers !== 1 ? 's' : ''}`}
                </p>
              </div>
              <div style={{ background: 'var(--surface-container)', padding: 16, borderRadius: 2 }}>
                <p style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 4 }}>Uptime</p>
                <p style={{ fontFamily: 'var(--font-headline)', fontSize: '1.5rem', fontWeight: 900, letterSpacing: '-0.05em' }}>
                  {formatUptime(trackerStats.uptime)}
                </p>
              </div>
            </div>

            <div style={{ background: 'var(--surface-container)', padding: 16, borderRadius: 2 }}>
              <p style={{ fontSize: 9, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 8 }}>Tracker Endpoint</p>
              <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--primary-container)', wordBreak: 'break-all' }}>
                {window.location.origin}/api/tracker/announce
              </p>
              <p style={{ fontSize: 9, color: '#6b7280', marginTop: 8, lineHeight: 1.6 }}>
                Swarms & peers update automatically as BitTorrent clients announce.
                Use the endpoint above in your <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 2 }}>.torrent</code> files.
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* ── Right sidebar ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Packet Velocity */}
        <section style={{ background: 'var(--surface-container)', borderRadius: 4, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontFamily: 'var(--font-headline)', fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--primary-container)', textTransform: 'uppercase' }}>
              Packet Velocity
            </h3>
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#6b7280' }}>monitoring</span>
          </header>
          <div style={{ height: 128, width: '100%', display: 'flex', alignItems: 'flex-end', gap: 4 }}>
            {velocityBars.map((h, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: `${h}%`,
                  background: `rgba(57,255,20,${0.1 + (h / 100) * 0.8})`,
                  transition: 'height 0.6s ease',
                }}
              />
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <span style={{ fontSize: 9, textTransform: 'uppercase', fontWeight: 700, color: '#6b7280', letterSpacing: '0.15em' }}>Swarms</span>
              <span style={{ display: 'block', fontFamily: 'var(--font-headline)', fontSize: 18, fontWeight: 900, letterSpacing: '-0.05em' }}>
                {trackerStats.totalSwarms}
              </span>
            </div>
            <div>
              <span style={{ fontSize: 9, textTransform: 'uppercase', fontWeight: 700, color: '#6b7280', letterSpacing: '0.15em' }}>Peers</span>
              <span style={{ display: 'block', fontFamily: 'var(--font-headline)', fontSize: 18, fontWeight: 900, letterSpacing: '-0.05em' }}>
                {trackerStats.totalPeers}
              </span>
            </div>
          </div>
        </section>

        {/* System Status */}
        <section style={{ background: 'var(--surface-container)', borderRadius: 4, padding: 20, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <h3 style={{ fontFamily: 'var(--font-headline)', fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--secondary-container)', textTransform: 'uppercase' }}>
            System Status
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              { label: 'Tracker Server',    sub: window.location.origin, status: trackerOnline ? 'ONLINE' : 'OFFLINE', color: trackerOnline ? 'var(--primary-container)' : 'var(--error)' },
              { label: 'Backend API',       sub: window.location.origin, status: apiOnline    ? 'ONLINE' : 'OFFLINE', color: apiOnline    ? 'var(--primary-container)' : 'var(--error)' },
              { label: 'Announce Interval', sub: 'Peer re-registration',  status: '60s',                              color: 'var(--secondary-container)' },
            ].map((item) => (
              <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#d1d5db', textTransform: 'uppercase', display: 'block' }}>{item.label}</span>
                  <span style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase' }}>{item.sub}</span>
                </div>
                <span style={{ fontSize: 12, fontFamily: 'monospace', color: item.color }}>{item.status}</span>
              </div>
            ))}
          </div>
          <div style={{ paddingTop: 16, borderTop: '1px solid rgba(60,75,53,0.15)' }}>
            <button
              onClick={() => { fetchTrackerStats(); fetchApiHealth(); }}
              style={{
                width: '100%', padding: 8, background: 'var(--surface-highest)',
                color: '#d1d5db', fontSize: 10, fontWeight: 700,
                letterSpacing: '0.15em', textTransform: 'uppercase',
                transition: 'color 0.15s ease',
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'white'}
              onMouseLeave={(e) => e.currentTarget.style.color = '#d1d5db'}
            >
              Refresh Status
            </button>
          </div>
        </section>

        {/* Terminal Log */}
        <section className="terminal" style={{ flex: 1 }}>
          <div className="terminal__dots">
            <div className="terminal__dot" />
            <div className="terminal__dot" />
            <div className="terminal__dot" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {logLines.map((line, i) => (
              <p
                key={i}
                className={line.color === 'green' ? 'terminal__line--green' : line.color === 'blue' ? 'terminal__line--blue' : ''}
              >
                {line.text}
              </p>
            ))}
            <p className="animate-pulse" style={{ color: 'var(--primary-container)' }}>_</p>
          </div>
        </section>
      </div>
    </div>
  );
}
