// utils/playerManager.js
// Player manager that tries Opus (low CPU) then falls back to ffmpeg->PCM
// Exports enqueue, joinChannel, skip, pause, resume, stop, getQueue, getNowPlaying.

const { joinVoiceChannel, createAudioPlayer, NoSubscriberBehavior, createAudioResource } = require('@discordjs/voice');
const { StreamType } = require('@discordjs/voice');
const prism = require('prism-media');

const guildMap = new Map();

function ensureGuild(guildId) {
	let g = guildMap.get(guildId);
	if (!g) {
		g = {
			connection: null,
			player: createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } }),
			queue: [],
			playing: null,
			subscription: null,
		};
		g.player.on('stateChange', (oldState, newState) => {
			if (oldState.status !== newState.status && newState.status === 'idle') {
				playNext(guildId).catch(() => {});
			}
		});
		g.player.on('error', (err) => {
			console.error(`Audio player error for ${guildId}:`, err);
			playNext(guildId).catch(() => {});
		});
		guildMap.set(guildId, g);
	}
	return guildMap.get(guildId);
}

function joinChannel(voiceChannel) {
	if (!voiceChannel) throw new Error('voiceChannel is required');
	const connection = joinVoiceChannel({
		channelId: voiceChannel.id,
		guildId: voiceChannel.guild.id,
		adapterCreator: voiceChannel.guild.voiceAdapterCreator,
	});
	const guild = ensureGuild(voiceChannel.guild.id);
	guild.connection = connection;
	guild.subscription = connection.subscribe(guild.player);
	return guild;
}

function transcodeToRaw(stream) {
	const ffmpeg = new prism.FFmpeg({
		args: [
			'-analyzeduration', '0',
			'-loglevel', '0',
			'-i', 'pipe:0',
			'-f', 's16le',
			'-ar', '48000',
			'-ac', '2',
			'pipe:1',
		],
	});
	stream.pipe(ffmpeg.stdin);
	return ffmpeg.stdout;
}

async function createAudioResourceForTrack(track) {
	console.log('DEBUG track (utils/playerManager.js):', JSON.stringify(track, Object.keys(track), 2));

	if (track.createStream && typeof track.createStream === 'function') {
		try {
			let opusStream;
			if (track.preferOpus) {
				try {
					opusStream = await track.createStream({ preferOpus: true });
				} catch (e) {}
			}
			if (!opusStream) {
				const fallbackStream = await track.createStream({ preferOpus: false }).catch(() => null);
				if (fallbackStream) {
					return createAudioResource(fallbackStream, { metadata: track, inlineVolume: true });
				}
			} else {
				return createAudioResource(opusStream, { metadata: track, inlineVolume: true });
			}
		} catch (err) {
			console.warn('Opus path failed, falling back to transcoding:', err?.message || err);
		}
	}

	if (typeof track.url === 'string' && /^https?:\/\//i.test(track.url)) {
		if (/\.(webm|opus)(\?.*)?$/i.test(track.url)) {
			try {
				return createAudioResource(track.url, { metadata: track, inlineVolume: true });
			} catch (e) {}
		}
		try {
			const ff = new prism.FFmpeg({
				args: [
					'-analyzeduration', '0',
					'-loglevel', '0',
					'-i', track.url,
					'-f', 's16le',
					'-ar', '48000',
					'-ac', '2',
					'pipe:1',
				],
			});
			return createAudioResource(ff.stdout, { metadata: track, inputType: StreamType.Raw, inlineVolume: true });
		} catch (e) {
			throw new Error('Failed to create resource from URL: ' + (e?.message || e));
		}
	}

	if (track.createStream && typeof track.createStream === 'function') {
		const inStream = await track.createStream({ preferOpus: false });
		if (!inStream || typeof inStream.pipe !== 'function') throw new Error('createStream did not return a readable stream.');
		const pcm = transcodeToRaw(inStream);
		return createAudioResource(pcm, { metadata: track, inputType: StreamType.Raw, inlineVolume: true });
	}

	throw new Error('No stream provider available for this track.');
}

async function enqueue(track, voiceChannel) {
	const guildId = voiceChannel.guild.id;
	const guild = ensureGuild(guildId);

	if (!guild.connection || guild.connection.joinConfig.channelId !== voiceChannel.id) {
		joinChannel(voiceChannel);
	}

	track.requestedAt = Date.now();
	guild.queue.push(track);

	if (guild.player.state.status === 'idle') {
		await playNext(guildId);
	}
	return guild.queue.length;
}

async function playNext(guildId) {
	const guild = guildMap.get(guildId);
	if (!guild) return;
	const next = guild.queue.shift();
	guild.playing = next || null;
	if (!next) return;
	try {
		const resource = await createAudioResourceForTrack(next);
		if (resource.volume && typeof resource.volume.setVolume === 'function') resource.volume.setVolume(0.8);
		guild.player.play(resource);
	} catch (err) {
		console.error('Failed to create/play resource:', err);
		return playNext(guildId);
	}
}

function skip(guildId) {
	const guild = guildMap.get(guildId);
	if (!guild) return false;
	guild.player.stop(true);
	return true;
}
function pause(guildId) {
	const guild = guildMap.get(guildId);
	if (!guild) return false;
	guild.player.pause();
	return true;
}
function resume(guildId) {
	const guild = guildMap.get(guildId);
	if (!guild) return false;
	guild.player.unpause();
	return true;
}
function stop(guildId) {
	const guild = guildMap.get(guildId);
	if (!guild) return false;
	guild.queue = [];
	guild.player.stop(true);
	if (guild.connection) {
		try { guild.connection.destroy(); } catch (e) {}
		guild.connection = null;
	}
	guild.playing = null;
	return true;
}
function getQueue(guildId) {
	const guild = guildMap.get(guildId);
	if (!guild) return [];
	return guild.queue.slice();
}
function getNowPlaying(guildId) {
	const guild = guildMap.get(guildId);
	if (!guild) return null;
	return guild.playing;
}

module.exports = {
	enqueue,
	joinChannel,
	playNext,
	skip,
	pause,
	resume,
	stop,
	getQueue,
	getNowPlaying,
	__internal: { guildMap, ensureGuild, createAudioResourceForTrack }
};
