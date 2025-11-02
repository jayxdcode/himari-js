const { SlashCommandBuilder } = require('discord.js');
const player = require('../../utils/playerManager');

module.exports = {
	data: new SlashCommandBuilder().setName('skip').setDescription('Skip current track.'),
	async execute(interaction) {
		const guildId = interaction.guildId;
		const ok = player.skip(guildId);
		return interaction.reply({ content: ok ? 'Skipped.' : 'Nothing to skip.', ephemeral: true });
	},
};
