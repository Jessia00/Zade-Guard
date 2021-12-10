import { CONFIG } from "./config";
import {
	Client,
	VoiceChannel,
	Collection,
	User,
	GuildMember,
	GuildChannel,
	MessageEmbed,
	TextChannel,
	Webhook,
	Guild,
} from "discord.js";
import * as pogger from "pogger";
import fetch from "node-fetch";
import { scheduleJob } from "node-schedule";
import { connect } from "mongoose";
import {
	ILimit,
	IRoleQueue,
	IChannelPermissions,
	IRolePermissions,
	IRoleChannelPermission,
} from "./types";
import { ChannelModel } from "./channelModel";
import { RoleModel } from "./roleModel";

const limitCollection = new Collection<string, ILimit>();
const roleQueue = new Collection<string, IRoleQueue>();
const roleMembers = new Collection<string, string[]>();
const rolePermissions = new Collection<string, IRoleChannelPermission[]>();
const client = new Client({
	disableMentions: "all",
	fetchAllMembers: true,
	partials: ["CHANNEL", "GUILD_MEMBER", "USER"],
	presence: {
		activity: {
			type: "PLAYING",
			name: "canzade338",
		},
	},
	ws: {
		intents: [
			"GUILDS",
			"GUILD_BANS",
			"GUILD_INTEGRATIONS",
			"GUILD_INVITES",
			"GUILD_MEMBERS",
			"GUILD_MESSAGES",
			"GUILD_MESSAGE_REACTIONS",
			"GUILD_MESSAGE_TYPING",
			"GUILD_VOICE_STATES",
			"GUILD_WEBHOOKS",
			"GUILD_EMOJIS",
		],
	},
});

client.on("ready", async () => {
	const voiceChannel = client.channels.cache.get(
		CONFIG.VOICE_CHANNEL,
	) as VoiceChannel;
	if (voiceChannel && voiceChannel.joinable) await voiceChannel.join();
	setRoleMembers();
	setRoleChannelPermissions();
	pogger.success(`[BOT] ${client.user?.tag} giriş yaptı.`);
	scheduleJob("*/1 * * * *", async () => {
		const now = Date.now();
		pogger.info("Cron job işleniyor");
		for (let i = 0; i < 5; i++) {
			const data = roleQueue.first();
			if (!data) continue;
			const guild = client.guilds.cache.get(data.guildID);
			if (!guild) continue;
			const member = guild.members.cache.get(data.userID);
			if (!member) continue;
			const roles = data.roleIDs.filter((roleID) =>
				guild.roles.cache.has(roleID),
			);
			await member.roles.add(roles);
			roleQueue.delete(data.userID);
		}
		setRoleMembers();
		setRoleChannelPermissions();
		pogger.success(
			`Cron job işlendi! Toplamda ${((Date.now() - now) / 1000).toFixed(
				2,
			)} saniye sürdü`,
		);
	});
});

client.on("guildMemberRemove", async (member) => {
	if (member.partial) member = await member.fetch();
	const log = await member.guild.fetchAuditLogs({
		limit: 1,
		type: "MEMBER_KICK",
	});
	const entry = log.entries.first();
	if (
		!entry ||
		!entry.executor ||
		entry.executor.equals(client.user as User) ||
		member.guild?.ownerID === entry.executor.id ||
entry.createdTimestamp - Date.now() > 5000 || CONFIG.BOT_USERS.includes(entry.executor.id)	)
		return;
	const executor = member.guild.member(entry.executor) as GuildMember;
	if (executor) checkLimit(executor, "Üye atmak.");
});

client.on("guildMemberAdd", async (member) => {
	if (member.user.bot) {
		if (member.partial) member = await member.fetch();
		const log = await member.guild.fetchAuditLogs({
			limit: 1,
			type: "BOT_ADD",
		});
		const entry = log.entries.first();
		pogger.info(
			`${member.user.tag} adlı bot sunucuya ${entry?.executor.tag} tarafından eklendi.`,
		);
		if (
			!entry ||
			!entry.executor ||
			entry.executor.equals(client.user as User) ||
			member.guild?.ownerID === entry.executor.id ||
entry.createdTimestamp - Date.now() > 5000 || CONFIG.BOT_USERS.includes(entry.executor.id)		)
			return;
		const executor = member.guild.member(entry.executor) as GuildMember;
		if (executor) checkLimit(executor, "Bot eklemek.");
	}
});

client.on("guildUpdate", async (oldGuild, newGuild) => {
	const log = await newGuild.fetchAuditLogs({
		limit: 1,
		type: "GUILD_UPDATE",
	});
	const entry = log.entries.first();
	if (
		!entry ||
		!entry.executor ||
		entry.executor.equals(client.user as User) ||
		newGuild.ownerID === entry.executor.id ||
entry.createdTimestamp - Date.now() > 5000 || CONFIG.BOT_USERS.includes(entry.executor.id)	)
		return;
	const executor = newGuild.member(entry.executor) as GuildMember;
	if (executor) checkLimit(executor, "Sunucuyu düzenlemek.");
	if (oldGuild.publicUpdatesChannelID != newGuild.publicUpdatesChannelID)
		await newGuild.setPublicUpdatesChannel(oldGuild.publicUpdatesChannelID);
	if (oldGuild.afkChannelID != newGuild.afkChannelID)
		await newGuild.setAFKChannel(oldGuild.afkChannelID);
	if (oldGuild.afkTimeout != newGuild.afkTimeout)
		await newGuild.setAFKTimeout(oldGuild.afkTimeout);
	if (oldGuild.rulesChannelID != newGuild.rulesChannelID)
		await newGuild.setRulesChannel(oldGuild.rulesChannelID);
	if (oldGuild.systemChannelID != newGuild.systemChannelID)
		await newGuild.setSystemChannel(oldGuild.systemChannelID);
	if (oldGuild.icon !== newGuild.icon)
		await newGuild.setIcon(oldGuild.iconURL({ dynamic: true }));
	if (oldGuild.banner !== newGuild.banner)
		await newGuild.setBanner(oldGuild.bannerURL());
	if (oldGuild.name !== newGuild.name) await newGuild.setName(oldGuild.name);
	if (oldGuild.vanityURLCode !== newGuild.vanityURLCode)
		await fetch(
			`https://discord.com/api/v8/guilds/${newGuild.id}/vanity-url`,
			{
				method: "PATCH",
				body: JSON.stringify({
					code: oldGuild.vanityURLCode,
				}),
				headers: {
					Authorization: `Bot ${client.token}`,
					"Content-Type": "application/json",
				},
			},
		);
});

client.on("guildBanAdd", async (guild, user) => {
	if (user.partial) user = await user.fetch();
	const log = await guild.fetchAuditLogs({
		limit: 1,
		type: "MEMBER_BAN_ADD",
	});
	const entry = log.entries.first();
	if (
		!entry ||
		!entry.executor ||
		entry.executor.equals(client.user as User) ||
		guild.ownerID === entry.executor.id ||
entry.createdTimestamp - Date.now() > 5000 || CONFIG.BOT_USERS.includes(entry.executor.id)	)
		return;
	const executor = guild.member(entry.executor) as GuildMember;
	if (executor) await checkLimit(executor, "Üye banlamak.");
	await guild.members.unban(user.id);
});

client.on("channelCreate", async (channel) => {
	if (channel.type === "dm") return;
	const log = await (channel as GuildChannel).guild.fetchAuditLogs({
		limit: 1,
		type: "CHANNEL_CREATE",
	});
	const entry = log.entries.first();
	if (
		!entry ||
		!entry.executor ||
		entry.executor.equals(client.user as User) ||
		(channel as GuildChannel).guild.ownerID === entry.executor.id ||
entry.createdTimestamp - Date.now() > 5000 || CONFIG.BOT_USERS.includes(entry.executor.id)	)
		return;
	const executor = (channel as GuildChannel).guild.member(
		entry.executor,
	) as GuildMember;
	if (executor) await checkLimit(executor, "Kanal oluşturmak.");
	await channel.delete();
});

client.on("channelUpdate", async (oldChannel, newChannel) => {
	if (newChannel.type === "dm") return;
	const log = await (newChannel as GuildChannel).guild.fetchAuditLogs({
		limit: 1,
		type: "CHANNEL_UPDATE",
	});
	const entry = log.entries.first();
	if (
		!entry ||
		!entry.executor ||
		entry.executor.equals(client.user as User) ||
		(newChannel as GuildChannel).guild.ownerID === entry.executor.id ||
		entry.createdTimestamp - Date.now() > 5000 || CONFIG.BOT_USERS.includes(entry.executor.id)	)
		return;
	const executor = (newChannel as GuildChannel).guild.member(
		entry.executor,
	) as GuildMember;
	if (executor) await checkLimit(executor, "Kanal güncellemek.");
	(newChannel as GuildChannel).edit({ ...(oldChannel as GuildChannel) });
});

client.on("channelDelete", async (channel) => {
	if (channel.type === "dm") return;
	const log = await (channel as GuildChannel).guild.fetchAuditLogs({
		limit: 1,
		type: "CHANNEL_DELETE",
	});
	const entry = log.entries.first();
	if (
		!entry ||
		!entry.executor ||
		entry.executor.equals(client.user as User) ||
		(channel as GuildChannel).guild.ownerID === entry.executor.id ||
		entry.createdTimestamp - Date.now() > 5000 || CONFIG.BOT_USERS.includes(entry.executor.id)	)
		return;
	const executor = (channel as GuildChannel).guild.member(
		entry.executor,
	) as GuildMember;
	if (executor) await checkLimit(executor, "Kanal silmek.");
	const newChannel = await (channel as GuildChannel).clone();
	await newChannel.setPosition((channel as GuildChannel).position);
});

client.on("webhookUpdate", async (channel) => {
	const log = await channel.guild.fetchAuditLogs({
		limit: 1,
		type: "WEBHOOK_CREATE",
	});
	const entry = log.entries.first();
	if (
		!entry ||
		!entry.executor ||
		entry.executor.equals(client.user as User) ||
		channel.guild.ownerID === entry.executor.id ||
		entry.createdTimestamp - Date.now() > 5000 || CONFIG.BOT_USERS.includes(entry.executor.id)	)
		return;
	const executor = channel.guild.member(entry.executor) as GuildMember;
	if (executor) await checkLimit(executor, "Webhook oluşturmak.");
	await (entry.target as Webhook).delete();
});

client.on("roleCreate", async (role) => {
	const log = await role.guild.fetchAuditLogs({
		limit: 1,
		type: "ROLE_CREATE",
	});
	const entry = log.entries.first();
	if (
		!entry ||
		!entry.executor ||
		entry.executor.equals(client.user as User) ||
		role.guild.ownerID === entry.executor.id ||
		entry.createdTimestamp - Date.now() > 5000 || CONFIG.BOT_USERS.includes(entry.executor.id)	)
		return;
	const executor = role.guild.member(entry.executor) as GuildMember;
	if (executor) await checkLimit(executor, "Rol oluşturmak.");
	await role.delete();
});

client.on("roleUpdate", async (oldRole, newRole) => {
	const log = await newRole.guild.fetchAuditLogs({
		limit: 1,
		type: "ROLE_UPDATE",
	});
	const entry = log.entries.first();
	if (
		!entry ||
		!entry.executor ||
		entry.executor.equals(client.user as User) ||
		newRole.guild.ownerID === entry.executor.id ||
		entry.createdTimestamp - Date.now() > 5000 || CONFIG.BOT_USERS.includes(entry.executor.id)	)
		return;
	const executor = newRole.guild.member(entry.executor) as GuildMember;
	if (executor) await checkLimit(executor, "Rol güncellemek.");
	newRole.edit({ ...oldRole });
});

client.on("roleDelete", async (role) => {
	const log = await role.guild.fetchAuditLogs({
		limit: 1,
		type: "ROLE_DELETE",
	});
	const entry = log.entries.first();
	if (
		!entry ||
		!entry.executor ||
		entry.executor.equals(client.user as User) ||
		role.guild.ownerID === entry.executor.id ||
		entry.createdTimestamp - Date.now() > 5000 || CONFIG.BOT_USERS.includes(entry.executor.id)	)
		return;
	const executor = role.guild.member(entry.executor) as GuildMember;
	if (executor) await checkLimit(executor, "Rol silmek.");
	const newRole = await role.guild.roles.create({ data: role });
	if (roleMembers.has(role.id)) {
		const memberArray = roleMembers.get(role.id) as string[];
		for (const id of memberArray) {
			const roleData = roleQueue.get(id);
			if (roleData)
				roleQueue.set(id, {
					guildID: role.guild.id,
					userID: id,
					roleIDs: [...roleData.roleIDs, newRole.id],
				});
			else
				roleQueue.set(id, {
					guildID: role.guild.id,
					userID: id,
					roleIDs: [newRole.id],
				});
		}
		roleMembers.delete(role.id);
		setRoleMembers();
	}
	if (rolePermissions.has(role.id)) {
		const permissionData = rolePermissions.get(
			role.id,
		) as IRoleChannelPermission[];
		for (const data of permissionData) {
			const channel = role.guild.channels.cache.get(data.channelID);
			if (channel) {
				await channel.createOverwrite(newRole, data.permissions);
			}
		}
		setRoleChannelPermissions();
	}
});

// utils


async function checkLimit(
	executor: GuildMember,
	reason: string,
): Promise<void> {
	const whitelisted = CONFIG.WHITELIST_USERS.includes(executor.id);
	if (whitelisted) {
		const limit = limitCollection.get(executor.id) as ILimit;
		if (limit) {
			const now = Date.now();
			if (now - limit.start > CONFIG.LIMIT_TIME)
				limitCollection.set(executor.id, {
					count: 1,
					start: Date.now(),
				});
			else {
				limit.count++;
				if (limit.count >= 3 && executor.bannable) {
					await punish(executor, reason);
					limitCollection.delete(executor.id);
				} else limitCollection.set(executor.id, limit);
			}
		} else
			limitCollection.set(executor.id, {
				count: 1,
				start: Date.now(),
			});
	} else punish(executor, reason);
}

async function punish(member: GuildMember, reason: string): Promise<void> {
	if (member.roles.cache.has(CONFIG.BOOSTER_ROLE)) {
		await member.roles.set([CONFIG.JAIL_ROLE, CONFIG.BOOSTER_ROLE]);
		log(
			member,
			reason,
			`${member.user.tag} bir veya birden çok işlem yaptığı için jaile atıldı.`,
		);
	} else {
		await member.ban({ reason });
		log(
			member,
			reason,
			`${member.user.tag} bir veya birden çok işlem yaptığı için banlandı.`,
		);
	}
}

async function log(
	member: GuildMember,
	reason: string,
	process: string,
): Promise<void> {
	const logChannel = client.channels.cache.get(
		CONFIG.LOG_CHANNEL,
	) as TextChannel;
	if (logChannel) {
		const embed = new MessageEmbed()
			.setTitle("Guard Log")
			.setDescription(`${member.toString()} cezalandırıldı.`)
			.addField("Uygulanan işlem: ", process)
			.addField("Sebep: ", reason)
			.setTimestamp(Date.now())
			.setFooter("Guard Log");
		await logChannel.send(embed);
		pogger.warning(process);
		pogger.info(`Sebep: ${reason}`);
	}
}


function setRoleMembers() {
	const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
	if (guild) {
		for (const role of guild.roles.cache.array()) {
			roleMembers.set(
				role.id,
				role.members.map((member) => member.id),
			);
		}
	}
}

function setRoleChannelPermissions() {
	const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
	if (guild) {
		for (const role of guild.roles.cache.array()) {
			const permissions: IRoleChannelPermission[] = [];
			for (const channel of guild.channels.cache.array()) {
				permissions.push({
					channelID: channel.id,
					permissions:
						channel.permissionsFor(role)?.serialize() || {},
				});
			}
			rolePermissions.set(role.id, permissions);
		}
	}
}

connect(CONFIG.MONGODB_URI, {
	useNewUrlParser: true,
	useUnifiedTopology: true,
	useFindAndModify: false,
	useCreateIndex: true,
}).then(() => {
	pogger.success("MongoDB'ye bağlanıldı.");
	client.login(CONFIG.BOT_TOKEN);
});
