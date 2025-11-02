const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder().setName('test').setDescription('Tests the bot playback logic [not yet functional]'),
	async execute(interaction) {
		await interaction.reply('Nah bro. its still not available :<');
	},
};
