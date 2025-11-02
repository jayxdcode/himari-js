const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const player = require('../../utils/playerManager');

module.exports = {
	data: new SlashCommandBuilder().setName('queue').setDescription('Show current queue.'),
	async execute(interaction) {
		const q = player.getQueue(interaction.guildId);
		const now = player.getNowPlaying(interaction.guildId);
		const embed = new EmbedBuilder().setTitle('Queue');
		if (now) embed.addFields({ name: 'Now playing', value: `${now.title} — requested by ${now.requestedBy?.username || 'unknown'}` });
		if (!q.length) embed.setDescription('Queue is empty.');
		else embed.addFields({ name: 'Up next', value: q.map((t, i) => `${i + 1}. ${t.title} — ${t.requestedBy?.username || 'unknown'}`).slice(0, 10).join('\n') });
		await interaction.reply({ embeds: [embed], ephemeral: true });
	},
};
