// ./commands/music/play.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const search = require('../../utils/search');
const player = require('../../utils/playerManager');

module.exports = {
        data: new SlashCommandBuilder()
                .setName('play')
                .setDescription('Play a track (url or search).')
                .addStringOption(opt => opt.setName('query').setDescription('URL or search term').setRequired(true)),
        async execute(interaction) {
                await interaction.deferReply({ ephemeral: false });

                // Get the query
                const query = interaction.options.getString('query', true);
                                                                       
                // Get a full GuildMember object. interaction.member may be a partial object that lacks .voice
                let member = interaction.member; // <-- 1. Use interaction.member, not interaction.user
                try {
                        if (!member || !member.voice) { // <-- 2. Check member.voice
                                // fetch the member from the guild to ensure voice state exists
                                if (interaction.guild) {
                                        console.log('Fetching full member for voice check...');
                                        member = await interaction.guild.members.fetch(interaction.user.id); // <-- 3. Corrected: .members.fetch
                                }
                        }
                } catch (err) {
                        console.warn('Failed to fetch member for voice check:', err?.message || err);
                        // proceed — member may still be ok, or the check below will fail
                }

                const voiceChannel = member?.voice?.channel; // <-- 4. Get channel from member
                if (!voiceChannel) {
                        return interaction.editReply({ content: 'You need to be in a voice channel to use this command.', ephemeral: true });
                }                                                      

                // Check bot permissions in the target voice channel
                const me = interaction.guild.members.me || (await interaction.guild.members.fetchMe?.().catch(() => null));
                if (me) {
                        const botPerms = voiceChannel.permissionsFor(me);
                        if (!botPerms || !botPerms.has(PermissionFlagsBits.Connect) || !botPerms.has(PermissionFlagsBits.Speak)) {
                                return interaction.editReply({ content: 'I need permission to join and speak in your voice channel.', ephemeral: true });
                        }
                }

                let track;
                try {
                        track = await search.getTrack(query, interaction.user);
                        console.log('DEBUG track (play.js):', JSON.stringify(track, Object.keys(track), 2));
                } catch (err) {
                        console.error('search.getTrack failed:', err);
                        return interaction.editReply({ content: 'Failed to resolve the query. Try a different search or check the bot logs.', ephemeral: true });
                }

                try {
                        const pos = await player.enqueue(track, voiceChannel);
                        return interaction.editReply({ content: `Queued **${track.title}** (position: ${pos}) — requested by ${interaction.user.username}` });
                } catch (err) {
                        console.error('enqueue failed:', err);
                        return interaction.editReply({ content: 'Failed to enqueue/play track. Check the bot logs for details.', ephemeral: true });
                }
        },
};

