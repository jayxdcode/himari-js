const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const player = require('../../utils/playerManager');

module.exports = {
	data: new SlashCommandBuilder().setName('nowplaying').setDescription('Show the currently playing track.'),
	async execute(interaction) {
		const now = player.getNowPlaying(interaction.guildId);
		if (!now) return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
		const embed = new EmbedBuilder()
			.setTitle(now.title || 'Unknown')
			.setDescription(now.artist ? `${now.artist} — ${now.album || ''}` : '')
			.setFooter({ text: `Requested by ${now.requestedBy?.username || 'unknown'}` });
		if (now.thumbnail) embed.setThumbnail(now.thumbnail);
		await interaction.reply({ embeds: [embed] });
	},
};
