const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder().setName('info').setDescription("Displays bot info"),
  execute: async function(interaction) { 

    // Use interaction.reply() for the primary response
    await interaction.reply({ content: 'Testing, testing. Bot is now **online**! (Replying to the command)', ephemeral: true });

    // --- EMBED MESSAGE ---
    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('[TEST] Startup Notification')
      .setDescription(`Bot **${interaction.applicationId}** has started.\n\nVersion 1.0.0 <unstable>`);
    
    try {
      // You can use interaction.channel.send() for a regular message
      await interaction.channel.send({ embeds: [embed] });
      console.log(`Sent command response and embed message to ${interaction.guild.name} (#${interaction.channel.name}).`);
    } catch (e) {
      console.error(`Failed to send embed message to ${interaction.guild.name}: ${e.message}`);
    }
  },
};

