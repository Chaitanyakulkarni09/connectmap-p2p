"""
Flask Status Server — exposes torrent client status to the React frontend.
Uses libtorrent for real BitTorrent support including DHT, PEX, and magnet links.
"""

import os
import sys
import time
import threading
import libtorrent as lt
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ── libtorrent session ────────────────────────────────────────────────────────
ses = lt.session()
ses.apply_settings({
    'listen_interfaces': '0.0.0.0:6881',
    'enable_dht': True,
    'enable_lsd': True,
    'enable_upnp': True,
    'enable_natpmp': True,
    'dht_bootstrap_nodes': 'router.bittorrent.com:6881,router.utorrent.com:6881,dht.transmissionbt.com:6881',
})

DOWNLOADS_DIR = os.path.join(os.path.dirname(__file__), 'downloads')
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

# info_hash_hex -> torrent handle
handles = {}
handles_lock = threading.Lock()


def _hex(h):
    """Convert libtorrent sha1_hash to hex string."""
    return str(h)


def _status_dict(h):
    """Convert a torrent handle's status to a JSON-serialisable dict."""
    s = h.status()
    info_hash = _hex(s.info_hashes.v1) if s.info_hashes.has_v1() else _hex(h.info_hash())

    # state names
    state_map = {
        lt.torrent_status.checking_files:          'checking',
        lt.torrent_status.downloading_metadata:    'downloading metadata',
        lt.torrent_status.downloading:             'downloading',
        lt.torrent_status.finished:                'seeding',
        lt.torrent_status.seeding:                 'seeding',
        lt.torrent_status.allocating:              'allocating',
        lt.torrent_status.checking_resume_data:    'checking',
    }
    state = state_map.get(s.state, str(s.state))

    total = s.total_wanted if s.total_wanted > 0 else 0
    downloaded = s.total_wanted_done if s.total_wanted_done > 0 else 0
    progress = s.progress if s.progress else 0.0

    eta = -1
    if s.download_rate > 0 and total > downloaded:
        eta = int((total - downloaded) / s.download_rate)

    ti = h.torrent_file()
    pieces_total = ti.num_pieces() if ti else 0
    pieces_have  = int(pieces_total * progress) if pieces_total else 0

    return {
        'info_hash':     info_hash,
        'name':          s.name or h.name(),
        'state':         state,
        'progress':      round(progress, 4),
        'download_rate': int(s.download_rate),
        'upload_rate':   int(s.upload_rate),
        'num_peers':     s.num_peers,
        'total_size':    total,
        'downloaded':    downloaded,
        'pieces_total':  pieces_total,
        'pieces_have':   pieces_have,
        'eta_seconds':   eta,
        'elapsed':       int(time.time() - handles.get(info_hash + '_start', time.time())),
        'ratio':         round(s.all_time_upload / s.all_time_download, 2) if s.all_time_download > 0 else 0,
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'client': 'BitTorrent libtorrent Client'})


@app.route('/download', methods=['POST'])
def start_download():
    data = request.get_json()
    if not data or 'torrent_path' not in data:
        return jsonify({'error': 'torrent_path is required'}), 400

    torrent_path = data['torrent_path']
    save_path    = data.get('save_path', DOWNLOADS_DIR)

    if not os.path.exists(torrent_path):
        return jsonify({'error': f'File not found: {torrent_path}'}), 404

    try:
        info = lt.torrent_info(torrent_path)
        params = {
            'ti':        info,
            'save_path': save_path,
        }
        h = ses.add_torrent(params)
        h.set_flags(lt.torrent_flags.sequential_download)

        # Announce to our own tracker so the Peers page shows activity
        h.add_tracker({'url': 'https://connectmap-p2p.onrender.com/announce', 'tier': 0})

        info_hash = _hex(info.info_hashes().v1) if info.info_hashes().has_v1() else _hex(info.info_hash())

        with handles_lock:
            handles[info_hash]              = h
            handles[info_hash + '_start']   = time.time()

        print(f"[libtorrent] Started: {info.name()} ({info_hash})")
        return jsonify({'status': 'started', 'info_hash': info_hash})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/status', methods=['GET'])
def get_all_status():
    result = []
    with handles_lock:
        for key, h in list(handles.items()):
            if key.endswith('_start'):
                continue
            try:
                result.append(_status_dict(h))
            except Exception:
                pass
    return jsonify({'downloads': result})


@app.route('/status/<info_hash>', methods=['GET'])
def get_status(info_hash):
    with handles_lock:
        h = handles.get(info_hash)
    if not h:
        return jsonify({'error': 'Download not found'}), 404
    try:
        return jsonify(_status_dict(h))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/stop/<info_hash>', methods=['POST'])
def stop_download(info_hash):
    with handles_lock:
        h = handles.pop(info_hash, None)
        handles.pop(info_hash + '_start', None)
    if not h:
        return jsonify({'error': 'Download not found'}), 404
    ses.remove_torrent(h)
    return jsonify({'status': 'stopped', 'info_hash': info_hash})


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    print(f"libtorrent client running on http://localhost:{port}")
    print(f"DHT enabled — no tracker needed")
    app.run(host='0.0.0.0', port=port, debug=False)
