// utils/search.js
// Verbose refactor: single YT Music provider + ytdlp-first streaming/metadata.
// Modified to prefer direct streamUrl and stream directly from it (skip download).

const { URL } = require('url');

const LOG = (...args) => {
        console.log('[utils/search]'.padEnd(16), ...args);
};

// === YT Music provider (single selected provider) ===
let ytmusic = null;
try {
        ytmusic = require('node-youtube-music');
        LOG('YTMusic provider: node-youtube-music loaded.');
} catch (e) {
        LOG('YTMusic provider: node-youtube-music NOT available — will skip YTMusic step.');
}

// === ytdlp-nodejs (preferred for metadata & streaming) ===
let YtDlp = null;
try {
        ({ YtDlp } = require('ytdlp-nodejs'));
        LOG('ytdlp-nodejs loaded (YtDlp available).');
} catch (e) {
        LOG('ytdlp-nodejs NOT available — YtDlp disabled.');
        YtDlp = null;
}

// === ytdl-core fallback for plain youtube URLs only ===
let ytdl = null;
try {
        ytdl = require('ytdl-core');
        LOG('ytdl-core loaded (fallback available).');
} catch (e) {
        LOG('ytdl-core NOT available — fallback disabled.');
        ytdl = null;
}

// === Utilities ===
function isUrl(str) {
        return typeof str === 'string' && /^https?:\/\//i.test(str);
}

function normalizeMusicYoutubeUrl(raw) {
        try {
                const u = new URL(raw);
                if (u.hostname.includes('music.youtube.com')) {
                        const vid = u.searchParams.get('v');
                        if (vid) return `https://www.youtube.com/watch?v=${vid}`;
                        u.hostname = 'www.youtube.com';
                        return u.toString();
                }
                return raw;
        } catch (e) {
                return raw;
        }
}

function selectBestAudioFormatFromFormats(formats = []) {
        let best = null;
        for (const f of formats || []) {
                if (!f || !f.url) continue;
                const isAudioOnly = (f.vcodec === 'none') || /audio/i.test(String(f.format || '')) || (f.acodec && !f.vcodec);
                if (!isAudioOnly && !f.url) continue;
                if (!best) { best = f; continue; }
                // prefer opus/webm
                if ((f.ext === 'webm' || /opus/i.test(String(f.acodec || ''))) && !(best.ext === 'webm' || /opus/i.test(String(best.acodec || '')))) {
                        best = f; continue;
                }
                const fTbr = Number(f.tbr || f.abr || f.bitrate || 0);
                const bTbr = Number(best.tbr || best.abr || best.bitrate || 0);
                if (fTbr > bTbr) best = f;
        }
        return best || null;
}

function ensureReadableStream(candidate) {
        if (!candidate) return null;
        if (typeof candidate.pipe === 'function') return candidate;
        if (candidate.stream && typeof candidate.stream.pipe === 'function') return candidate.stream;
        if (candidate.stdout && typeof candidate.stdout.pipe === 'function') return candidate.stdout;
        if (candidate.proc && candidate.proc.stdout && typeof candidate.proc.stdout.pipe === 'function') return candidate.proc.stdout;
        return null;
}

function parseYtDlpJsonOutput(out) {
        if (!out || typeof out !== 'string') return null;
        const lines = out.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
                try {
                        const parsed = JSON.parse(line);
                        if (parsed && parsed.entries && Array.isArray(parsed.entries) && parsed.entries.length) {
                                return parsed.entries[0];
                        }
                        if (Array.isArray(parsed) && parsed.length) return parsed[0];
                        return parsed;
                } catch (e) {
                        // ignore and continue
                }
        }
        return null;
}

// === ytdlp metadata helper ===
async function metaFromYtDlp(urlStr) {
        if (!YtDlp) {
                LOG('metaFromYtDlp: YtDlp not available.');
                return null;
        }
        LOG('metaFromYtDlp: fetching metadata for', urlStr);
        const yt = new YtDlp();
        try {
                const args = ['-j', '--no-warnings', '--skip-download'];
                const out = await yt.execAsync(urlStr, { args });
                if (!out) {
                        LOG('metaFromYtDlp: no output from execAsync for', urlStr);
                        return null;
                }
                const info = parseYtDlpJsonOutput(out);
                if (!info) {
                        LOG('metaFromYtDlp: failed to parse yt-dlp output for', urlStr);
                        return null;
                }
                const thumbnail = (info.thumbnails && info.thumbnails[info.thumbnails.length - 1]?.url) || info.thumbnail || null;
                const duration = typeof info.duration === 'number' ? info.duration : Number(info.duration) || null;
                const bestFmt = selectBestAudioFormatFromFormats(info.formats || []);
                const streamUrl = bestFmt && bestFmt.url ? bestFmt.url : null;
                const meta = {
                        url: info.webpage_url || info.url || urlStr,
                        title: info.title || urlStr,
                        artist: info.uploader || info.artist || null,
                        album: info.album || null,
                        thumbnail,
                        duration,
                        streamUrl,
                        rawInfo: info,
                };
                LOG('metaFromYtDlp: got meta', { url: meta.url, title: meta.title, duration: meta.duration, streamUrl: !!meta.streamUrl });
                return meta;
        } catch (err) {
                LOG('metaFromYtDlp: error for', urlStr, err && (err.message || err));
                return null;
        }
}

// === Builders ===
function buildTrackFromMeta(meta, requestedBy) {
        // IMPORTANT: prefer direct stream URL if present — return it immediately
        const createStream = async (opts = {}) => {
                // If meta.streamUrl exists, return it directly so the player can stream from the URL (no child processes).
                if (meta.streamUrl && typeof meta.streamUrl === 'string') {
                        LOG('createStream: returning direct meta.streamUrl for', meta.url);
                        return meta.streamUrl;
                }

                // Fallback to ytdlp streaming when a direct stream URL is not available.
                if (!YtDlp) throw new Error('ytdlp-nodejs required for streaming fallback');
                const yt = new YtDlp();
                const format = opts.preferOpus ? 'bestaudio[ext=webm]/bestaudio' : 'bestaudio';
                LOG('createStream: attempting yt.stream for', meta.url, 'format=', format);
                let maybe = null;
                try { maybe = yt.stream(meta.url || meta.rawInfo?.webpage_url || meta.url, { format }); } catch (e) { maybe = null; }
                if (maybe && typeof maybe.then === 'function') {
                        try { maybe = await maybe; } catch (e) { maybe = null; }
                }
                const st = ensureReadableStream(maybe);
                if (st) {
                        LOG('createStream: obtained readable stream from ytdlp for', meta.url);
                        return st;
                }
                // As a last-ditch attempt, return the meta.streamUrl (again) or throw.
                if (meta.streamUrl) {
                        LOG('createStream: falling back to meta.streamUrl for', meta.url);
                        return meta.streamUrl;
                }
                throw new Error('ytdlp-nodejs returned no readable stream and no direct streamUrl');
        };

        return {
                url: meta.url || null,
                streamUrl: meta.streamUrl || null,
                title: meta.title || null,
                artist: meta.artist || null,
                album: meta.album || null,
                thumbnail: meta.thumbnail || null,
                duration: meta.duration || null,
                requestedBy,
                createStream,
                preferOpus: true,
                _rawInfo: meta.rawInfo || null,
        };
}

function buildTrackFromYtMusicItem(item, requestedBy) {
        const youtubeId = item.youtubeId || item.videoId || item.id || (item.result && item.result.videoId);
        const title = item.title || item.name || item.videoTitle || item.titleText?.simpleText || 'Unknown title';
        const artist = (item.artists && item.artists.map(a => (a.name || a)).join(', ')) || item.artist || item.authors?.join?.(', ') || null;
        const thumbnail = item.thumbnail || (item.thumbnails && item.thumbnails[0] && item.thumbnails[0].url) || null;
        const videoUrl = youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : null;

        const createStream = async (opts = {}) => {
                LOG('buildTrackFromYtMusicItem.createStream: videoUrl=', videoUrl, 'preferOpus=', !!opts.preferOpus);
                // Prefer enriching via ytdlp and prefer direct streamUrl when available.
                if (videoUrl && YtDlp) {
                        const meta = await metaFromYtDlp(videoUrl).catch(() => null);
                        if (meta) {
                                LOG('buildTrackFromYtMusicItem.createStream: enriched meta found');
                                // If meta has a direct streamUrl, buildTrackFromMeta's createStream will return it immediately.
                                return buildTrackFromMeta(meta, requestedBy).createStream(opts);
                        }

                        // If enrichment failed but YtDlp available, try streaming — but we only use yt.stream as fallback.
                        const yt = new YtDlp();
                        let maybe = null;
                        try { maybe = yt.stream(videoUrl, { format: opts.preferOpus ? 'bestaudio[ext=webm]/bestaudio' : 'bestaudio' }); } catch (e) { maybe = null; }
                        if (maybe && typeof maybe.then === 'function') {
                                try { maybe = await maybe.catch(() => null); } catch (e) { maybe = null; }
                        }
                        const st = ensureReadableStream(maybe);
                        if (st) {
                                LOG('buildTrackFromYtMusicItem.createStream: obtained stream from ytdlp for', videoUrl);
                                return st;
                        }
                }

                // ytdl fallback: if we can get a direct format URL, return it (no child process).
                if (ytdl && videoUrl) {
                        try {
                                const info = await ytdl.getInfo(videoUrl);
                                const fmt = selectBestAudioFormatFromFormats(info.formats || []);
                                if (fmt && fmt.url) {
                                        LOG('buildTrackFromYtMusicItem.createStream: returning direct fmt.url from ytdl for', videoUrl);
                                        return fmt.url; // return direct URL string
                                }
                        } catch (e) {
                                LOG('buildTrackFromYtMusicItem.createStream: ytdl.getInfo error', e && (e.message || e));
                        }
                        LOG('buildTrackFromYtMusicItem.createStream: returning ytdl stream for', videoUrl);
                        // fallback to streaming via ytdl (readable stream)
                        return ytdl(videoUrl, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1 << 25 });
                }
                throw new Error('No stream provider available. Install ytdlp-nodejs or ytdl-core.');
        };

        return {
                url: videoUrl || null,
                streamUrl: null,
                title,
                artist,
                album: null,
                thumbnail,
                duration: null,
                requestedBy,
                createStream,
                preferOpus: true,
                _rawItem: item,
        };
}

async function searchYouTubeMusicFirst(query) {
        if (!ytmusic) {
                LOG('searchYouTubeMusicFirst: node-youtube-music provider not available.');
                return null;
        }
        LOG('searchYouTubeMusicFirst: searching YT Music for', query);
        try {
                const res = await ytmusic.search(query, { type: 'song' }).catch?.(e => { throw e; }) || await ytmusic.search(query, { type: 'song' });
                if (Array.isArray(res) && res.length) {
                        LOG('searchYouTubeMusicFirst: YT Music returned', res.length, 'items');
                        return res;
                }
                if (res && res.results && Array.isArray(res.results) && res.results.length) {
                        LOG('searchYouTubeMusicFirst: YT Music returned results[]', res.results.length);
                        return res.results;
                }
                LOG('searchYouTubeMusicFirst: YT Music returned no results');
                return null;
        } catch (err) {
                LOG('searchYouTubeMusicFirst: error', err && (err.message || err));
                return null;
        }
}

// === Main exported function (verbose) ===
/**
 * getTrack(query, requestedBy) => Promise<track object>
 * track object fields (kept compatible):
 *  - url (canonical watch URL or ytsearch1:... when unavoidable)
 *  - streamUrl (direct media URL when available)
 *  - artist, album, title, thumbnail, duration
 *  - requestedBy
 *  - createStream() => Readable stream or URL
 *  - preferOpus
 *  - _rawInfo / _rawItem for debugging
 */
async function getTrack(query, requestedBy) {
        LOG('getTrack: entry', { query, requestedBy });
        if (!query) throw new Error('Empty query');

        if (isUrl(query) && query.includes('music.youtube.com')) {
                query = normalizeMusicYoutubeUrl(query);
                LOG('getTrack: normalized music.youtube url ->', query);
        }

        // 1) Non-URL: try YT Music provider (single) then ytdlp search (ytsearch1:)
        if (!isUrl(query)) {
                LOG('getTrack: non-url query path for', query);

                try {
                        const items = await searchYouTubeMusicFirst(query);
                        if (items && items.length) {
                                const item = items[0];
                                LOG('getTrack: using top YTMusic item', item.title || item.name || item.videoTitle || item.id);
                                const prelim = buildTrackFromYtMusicItem(item, requestedBy);
                                // attempt to enrich via ytdlp to get canonical youtube watch URL and full meta
                                if (prelim.url && YtDlp) {
                                        const meta = await metaFromYtDlp(prelim.url).catch(() => null);
                                        if (meta) {
                                                LOG('getTrack: enriched YTMusic item with ytdlp meta ->', meta.url);
                                                const t = buildTrackFromMeta(meta, requestedBy);
                                                t._fromYtMusic = item;
                                                return t;
                                        }
                                        LOG('getTrack: no ytdlp meta for YTMusic item, returning preliminary track (has createStream).');
                                }
                                return prelim;
                        }
                } catch (err) {
                        LOG('getTrack: YTMusic provider failed', err && (err.message || err));
                }

                if (YtDlp) {
                        const searchPrefixed = `ytsearch1:${query}`;
                        LOG('getTrack: falling back to ytdlp search for', searchPrefixed);
                        const meta = await metaFromYtDlp(searchPrefixed).catch(() => null);
                        if (meta) {
                                LOG('getTrack: ytdlp search resolved to', meta.url);
                                return buildTrackFromMeta(meta, requestedBy);
                        }
                        LOG('getTrack: ytdlp search returned no metadata for', query);
                        throw new Error(`No results found for "${query}"`);
                }

                LOG('getTrack: no providers available for non-URL search.');
                throw new Error('No search provider available (install node-youtube-music or ytdlp-nodejs).');
        }

        // 2) URL: prefer ytdlp metadata + streaming
        if (isUrl(query)) {
                LOG('getTrack: URL query path for', query);
                if (YtDlp) {
                        const meta = await metaFromYtDlp(query).catch(() => null);
                        if (meta) {
                                LOG('getTrack: got ytdlp metadata for URL, returning full track');
                                return buildTrackFromMeta(meta, requestedBy);
                        }
                        LOG('getTrack: ytdlp meta not available for URL; returning minimal track with streaming attempt.');
                        const createStream = async (opts = {}) => {
                                // Prefer returning a direct URL if ytdlp can provide one — but since meta didn't exist, we try yt.stream as fallback.
                                if (!YtDlp) throw new Error('ytdlp-nodejs required for streaming');
                                const yt = new YtDlp();
                                let maybe = null;
                                try { maybe = yt.stream(query, { format: opts.preferOpus ? 'bestaudio[ext=webm]/bestaudio' : 'bestaudio' }); } catch (e) { maybe = null; }
                                if (maybe && typeof maybe.then === 'function') maybe = await maybe.catch(() => null);
                                const st = ensureReadableStream(maybe);
                                if (st) return st;
                                throw new Error('ytdlp-nodejs returned no readable stream for URL');
                        };
                        return {
                                url: query,
                                streamUrl: null,
                                title: query,
                                artist: null,
                                album: null,
                                thumbnail: null,
                                duration: null,
                                requestedBy,
                                createStream,
                                preferOpus: true,
                        };
                }

                // ytdl fallback for plain youtube links
                if (ytdl && /youtube\.com|youtu\.be/.test(query)) {
                        LOG('getTrack: using ytdl fallback for', query);
                        const info = await ytdl.getInfo(query).catch(() => null);
                        const vd = info?.videoDetails || {};
                        let streamUrl = null;
                        try {
                                const fmt = selectBestAudioFormatFromFormats(info?.formats || []);
                                if (fmt && fmt.url) streamUrl = fmt.url;
                        } catch (e) {
                                LOG('getTrack: ytdl select format error', e && (e.message || e));
                        }
                        return {
                                url: query,
                                streamUrl,
                                title: vd.title || query,
                                artist: (vd.media && vd.media.artist) || vd.author?.name || null,
                                album: (vd.media && vd.media.album) || null,
                                thumbnail: vd.thumbnails?.pop()?.url || null,
                                duration: Number(vd.lengthSeconds || 0),
                                requestedBy,
                                createStream: async (opts = {}) => {
                                        LOG('getTrack.createStream (ytdl fallback) for', query);
                                        // If we already found a direct streamUrl, return it (skip streaming).
                                        if (streamUrl) return streamUrl;
                                        return ytdl(query, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1 << 25 });
                                },
                                preferOpus: false,
                        };
                }

                LOG('getTrack: URL provided but no streaming provider available.');
                throw new Error('No stream provider available for the provided URL.');
        }

        // Shouldn't get here
        throw new Error('Unhandled query type in getTrack');
}

module.exports = { getTrack };
