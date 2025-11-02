const { SlashCommandBuilder } = require('discord.js');
const player = require('../../utils/playerManager');

module.exports = {
	data: new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear the queue.'),
	async execute(interaction) {
		const ok = player.stop(interaction.guildId);
		return interaction.reply({ content: ok ? 'Stopped and cleared queue.' : 'Nothing to stop.', ephemeral: true });
	},
};
