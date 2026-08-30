import {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { createEmbed, successEmbed } from '../../../utils/embeds.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';
import {
  getShopConfig,
  getShopPlan,
  saveShopTicket,
  getShopTicket,
  setAdminPendingConfig,
  SHOP_CARD_NUMBER,
  SHOP_CARD_HOLDER,
} from '../../../services/titanShopService.js';
import { getShopSettings } from '../../../services/titanShopSettingsService.js';
import { provisionTestConfig, isPasargadConfigured } from '../../../services/pasargadService.js';
import {
  buildPlanSelectRow,
  buildPaidCancelButtons,
  buildPlanFields,
  SHOP_BUY_CUSTOM_ID,
  SHOP_TEST_CUSTOM_ID,
} from '../../../services/titanShopUI.js';

const buyHandler = {
  name: SHOP_BUY_CUSTOM_ID,
  async execute(interaction, client) {
    try {
      const config = await getShopConfig(client, interaction.guildId);
      if (!config.panelChannelId) {
        return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'پنل خرید در این سرور تنظیم نشده است.' });
      }

      const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferred) return;

      const embed = createEmbed({
        title: 'تعرفه‌ها',
        description:
          'تعرفه موردنظر خود را از منوی زیر انتخاب کنید.\n' +
          'پس از انتخاب، اطلاعات پرداخت نمایش داده می‌شود.',
        color: 'primary',
        fields: buildPlanFields(),
      });

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [embed],
        components: [buildPlanSelectRow()],
      });
    } catch (error) {
      logger.error('titan_shop_buy failed', { error: error.message, guildId: interaction.guildId });
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'خطایی رخ داد. دوباره تلاش کنید.' });
    }
  },
};

const paidHandler = {
  name: 'titan_shop_paid',
  async execute(interaction, client, args) {
    try {
      const planValue = args?.[0];
      const plan = getShopPlan(planValue);
      if (!plan) {
        return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'تعرفه انتخاب‌شده معتبر نیست.' });
      }

      const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferred) return;

      const config = await getShopConfig(client, interaction.guildId);
      if (!config.panelChannelId) {
        return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'پنل خرید در این سرور تنظیم نشده است.' });
      }

      const channel = await interaction.guild.channels.create({
        name: `config-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user'}-${Date.now().toString(36)}`,
        type: ChannelType.GuildText,
        parent: interaction.channel?.parentId || undefined,
        permissionOverwrites: [
          {
            id: interaction.guild.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
        ],
      });

      const ticket = {
        channelId: channel.id,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        plan: plan.value,
        planLabel: plan.label,
        price: plan.price,
        status: 'awaiting_receipt',
        createdAt: new Date().toISOString(),
      };
      await saveShopTicket(client, interaction.guildId, ticket);

      const embed = createEmbed({
        title: 'ارسال رسید',
        description:
          'لطفاً **رسید پرداخت** را به‌صورت تصویر در همین چنل ارسال کنید.\n\n' +
          'پس از تأیید توسط مدیر، کانفیگ برای شما ارسال خواهد شد.',
        color: 'success',
        fields: [
          { name: 'تعرفه انتخابی', value: plan.label, inline: true },
          { name: 'مبلغ', value: plan.price, inline: true },
        ],
      });

      const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`titan_shop_close_ticket:${interaction.guildId}:${channel.id}`)
          .setLabel('بستن این گفتگو')
          .setStyle(ButtonStyle.Danger),
      );

      await channel.send({
        content: `<@${interaction.user.id}>`,
        embeds: [embed],
        components: [closeRow],
      });

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [successEmbed('پنل پرداخت', `چنل پرداخت شما ساخته شد: ${channel}\nلطفاً رسید پرداخت را آنجا ارسال کنید.`)],
      });

      logger.info('Titan shop purchase channel created', {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: channel.id,
        plan: plan.value,
        commandName: 'titan_shop_paid',
      });
    } catch (error) {
      logger.error('titan_shop_paid failed', {
        error: error.message,
        stack: error.stack,
        guildId: interaction.guildId,
      });
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'ساخت چنل پرداخت با خطا مواجه شد. دوباره تلاش کنید.' });
    }
  },
};

const testHandler = {
  name: SHOP_TEST_CUSTOM_ID,
  async execute(interaction, client) {
    try {
      const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferred) return;

      const settings = await getShopSettings(client);
      const config = await getShopConfig(client, interaction.guildId);

      if (settings.testEnabled && config?.mode === 'auto' && isPasargadConfigured(settings.pasargad)) {
        const result = await provisionTestConfig(settings.pasargad, {
          username: `test_${interaction.user.id}`,
          volumeGb: 0.1,
          durationDays: 1,
        });
        if (result.success && result.config) {
          return await InteractionHelper.safeEditReply(interaction, {
            embeds: [createEmbed({
              title: '🎁 کانفیگ تست (۱۰۰MB)',
              description: 'این یک تست رایگان ۱۰۰MB است.\n\n**کانفیگ:**\n```\n' + result.config + '\n```',
              color: 'success',
            })],
          });
        }
        logger.error('Test provision failed', { error: result.error, userId: interaction.user.id });
      }

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [createEmbed({
          title: 'تست کانفیگ',
          description: 'در حال حاضر تست موجود نمی‌باشد.',
          color: 'secondary',
        })],
      });
    } catch (error) {
      logger.error('titan_shop_test failed', { error: error.message, guildId: interaction.guildId });
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'خطایی رخ داد.' });
    }
  },
};

const cancelHandler = {
  name: 'titan_shop_cancel',
  async execute(interaction, client, args) {
    try {
      const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferred) return;

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [createEmbed({
          title: '❌ لغو شد',
          description: 'فرایند خرید لغو شد. اگر باز هم تمایل داشتید، از دکمه خرید استفاده کنید.',
          color: 'secondary',
        })],
        components: [],
      });
    } catch (error) {
      logger.error('titan_shop_cancel failed', { error: error.message, guildId: interaction.guildId });
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'خطایی رخ داد.' });
    }
  },
};

const approveHandler = {
  name: 'titan_shop_approve',
  async execute(interaction, client, args) {
    try {
      const guildId = args?.[0];
      const channelId = args?.[1];
      if (!guildId || !channelId) {
        return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'مشخصات تیکت کامل نیست.' });
      }

      const ticket = await getShopTicket(client, guildId, channelId);
      if (!ticket) {
        return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'تیم برای این چنل پیدا نشد.' });
      }

      const config = await getShopConfig(client, guildId);
      const adminIds = [];
      if (config.adminUserId) {
        adminIds.push(config.adminUserId);
      }
      if (config.adminRoleId) {
        const guild = client.guilds.cache.get(guildId);
        const role = guild?.roles.cache.get(config.adminRoleId);
        if (role) {
          for (const member of role.members.values()) {
            if (!member.user.bot) {
              adminIds.push(member.id);
            }
          }
        }
      }
      if (adminIds.length > 0 && !adminIds.includes(interaction.user.id)) {
        return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'شما مجاز به تأیید این خرید نیستید.' });
      }

      const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferred) return;

      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'سرور مربوطه در دسترس نیست.' });
      }

      const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
      if (!channel) {
        return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'چنل تیکت یافت نشد.' });
      }

      ticket.status = 'approved';
      await saveShopTicket(client, guildId, ticket);

      await setAdminPendingConfig(client, interaction.user.id, {
        guildId,
        channelId,
        userId: ticket.userId,
        plan: ticket.plan,
        planLabel: ticket.planLabel,
      });

      await channel.send({
        embeds: [createEmbed({
          title: '✅ پرداخت تأیید شد',
          description: `رسید شما تأیید شد. کانفیگ ${ticket.planLabel} به‌زودی برای شما ارسال می‌شود.`,
          color: 'success',
        })],
      });

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [createEmbed({
          title: '✅ تأیید شد — ارسال کانفیگ',
          description:
            'خرید تأیید شد. اکنون **متن کانفیگ** را در همین گفتگوی خصوصی (DM) برای ربات بنویسید.\n\n' +
            'ربات به‌صورت خودکار آن را برای کاربر در چنل تیکتش ارسال می‌کند.',
          color: 'success',
        })],
        components: [],
      });
    } catch (error) {
      logger.error('titan_shop_approve failed', { error: error.message, guildId: interaction.guildId });
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'خطایی رخ داد.' });
    }
  },
};

const rejectHandler = {
  name: 'titan_shop_reject',
  async execute(interaction, client, args) {
    try {
      const guildId = args?.[0];
      const channelId = args?.[1];
      if (!guildId || !channelId) {
        return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'مشخصات تیکت کامل نیست.' });
      }

      const ticket = await getShopTicket(client, guildId, channelId);
      if (!ticket) {
        return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'تیم برای این چنل پیدا نشد.' });
      }

      const config = await getShopConfig(client, guildId);
      const adminIds = [];
      if (config.adminUserId) {
        adminIds.push(config.adminUserId);
      }
      if (config.adminRoleId) {
        const guild = client.guilds.cache.get(guildId);
        const role = guild?.roles.cache.get(config.adminRoleId);
        if (role) {
          for (const member of role.members.values()) {
            if (!member.user.bot) {
              adminIds.push(member.id);
            }
          }
        }
      }
      if (adminIds.length > 0 && !adminIds.includes(interaction.user.id)) {
        return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'شما مجاز به رد این خرید نیستید.' });
      }

      const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferred) return;

      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'سرور مربوطه در دسترس نیست.' });
      }

      const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
      if (channel) {
        await channel.send({
          embeds: [createEmbed({
            title: '❌ تأیید نشد',
            description: 'رسید شما تأیید نشد. لطفاً با مدیر فروشگاه در ارتباط باشید.',
            color: 'error',
          })],
        });
      }

      ticket.status = 'rejected';
      await saveShopTicket(client, guildId, ticket);

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [createEmbed({
          title: '❌ تأیید نشد',
          description: 'به کاربر اطلاع داده شد که رسید تأیید نشده است.',
          color: 'secondary',
        })],
        components: [],
      });
    } catch (error) {
      logger.error('titan_shop_reject failed', { error: error.message, guildId: interaction.guildId });
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'خطایی رخ داد.' });
    }
  },
};

const closeTicketHandler = {
  name: 'titan_shop_close_ticket',
  async execute(interaction, client, args) {
    try {
      const guildId = args?.[0];
      const channelId = args?.[1];
      if (!guildId || guildId !== interaction.guildId || !channelId || channelId !== interaction.channelId) {
        return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'این اکشن فقط در چنل تیکت خودتان قابل استفاده است.' });
      }

      const ticket = await getShopTicket(client, interaction.guildId, interaction.channelId);
      if (!ticket || ticket.userId !== interaction.user.id) {
        return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'شما اجازه بستن این گفتگو را ندارید.' });
      }

      const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferred) return;

      await interaction.channel.delete('Shop ticket closed by user').catch(() => {});

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [successEmbed('بسته شد', 'این گفتگو بسته شد.')],
      });
    } catch (error) {
      logger.error('titan_shop_close_ticket failed', { error: error.message, guildId: interaction.guildId });
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'خطایی رخ داد.' });
    }
  },
};

export default [
  buyHandler,
  testHandler,
  paidHandler,
  cancelHandler,
  approveHandler,
  rejectHandler,
  closeTicketHandler,
];