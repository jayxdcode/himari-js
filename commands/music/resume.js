const { SlashCommandBuilder } = require('discord.js');
const player = require('../../utils/playerManager');

module.exports = {
	data: new SlashCommandBuilder().setName('resume').setDescription('Resume playback.'),
	async execute(interaction) {
		const ok = player.resume(interaction.guildId);
		return interaction.reply({ content: ok ? 'Resumed.' : 'Nothing to resume.', ephemeral: true });
	},
};
