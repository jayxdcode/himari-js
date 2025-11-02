const { SlashCommandBuilder } = require('discord.js');
const player = require('../../utils/playerManager');

module.exports = {
	data: new SlashCommandBuilder().setName('pause').setDescription('Pause playback.'),
	async execute(interaction) {
		const ok = player.pause(interaction.guildId);
		return interaction.reply({ content: ok ? 'Paused.' : 'Nothing is playing.', ephemeral: true });
	},
};
