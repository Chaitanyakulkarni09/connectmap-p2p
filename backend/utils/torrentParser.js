const crypto = require('crypto');
const { decodeWithInfo } = require('./bencode');

/**
 * Parse a .torrent file buffer and extract all metadata
 */
function parseTorrent(buffer) {
  const { data, infoBuffer } = decodeWithInfo(buffer);

  if (!data.info) {
    throw new Error('Invalid torrent: missing info dictionary');
  }

  const info = data.info;

  // Calculate info_hash (SHA-1 of the raw bencoded info dict)
  const infoHash = crypto.createHash('sha1').update(infoBuffer).digest('hex');

  // Extract file list
  let files = [];
  let totalSize = 0;

  if (info.files) {
    // Multi-file torrent
    for (const f of info.files) {
      const pathParts = f.path.map((p) =>
        Buffer.isBuffer(p) ? p.toString('utf8') : p
      );
      const filePath = pathParts.join('/');
      const size = typeof f.length === 'number' ? f.length : 0;
      files.push({ path: filePath, size });
      totalSize += size;
    }
  } else {
    // Single-file torrent
    const name = Buffer.isBuffer(info.name)
      ? info.name.toString('utf8')
      : info.name;
    const size = typeof info.length === 'number' ? info.length : 0;
    files.push({ path: name, size });
    totalSize = size;
  }

  const name = Buffer.isBuffer(info.name)
    ? info.name.toString('utf8')
    : info.name;

  const pieceLength = info['piece length'] || 0;

  // pieces is a concatenation of 20-byte SHA-1 hashes
  const piecesBuffer = Buffer.isBuffer(info.pieces) ? info.pieces : Buffer.from([]);
  const pieceCount = Math.floor(piecesBuffer.length / 20);

  // Extract tracker URL
  const announce = data.announce
    ? Buffer.isBuffer(data.announce)
      ? data.announce.toString('utf8')
      : data.announce
    : '';

  // Announce list (backup trackers)
  let announceList = [];
  if (data['announce-list']) {
    announceList = data['announce-list'].map((tier) =>
      tier.map((url) => (Buffer.isBuffer(url) ? url.toString('utf8') : url))
    );
  }

  return {
    infoHash,
    name,
    totalSize,
    pieceLength,
    pieceCount,
    piecesHex: piecesBuffer.toString('hex'),
    files,
    announce,
    announceList,
  };
}

/**
 * Generate a magnet URI from torrent metadata
 * Includes all announce tiers so clients use our tracker first
 */
function generateMagnet(infoHash, name, trackerUrl, announceList) {
  let magnet = `magnet:?xt=urn:btih:${infoHash}`;
  if (name) magnet += `&dn=${encodeURIComponent(name)}`;

  // Collect all unique tracker URLs, primary first
  const trackers = new Set();
  if (trackerUrl) trackers.add(trackerUrl);
  if (announceList) {
    for (const tier of announceList) {
      for (const url of tier) {
        if (url) trackers.add(url);
      }
    }
  }
  for (const tr of trackers) {
    magnet += `&tr=${encodeURIComponent(tr)}`;
  }
  return magnet;
}

module.exports = { parseTorrent, generateMagnet };
