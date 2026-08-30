// titanShopHandler.js — receipt forwarding to admins and DM-based config delivery.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} from 'discord.js';
import { createEmbed, successEmbed, infoEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import {
  getShopConfig,
  getShopTicket,
  saveShopTicket,
  getShopAdminsNoInteraction,
  getAdminPendingConfig,
  clearAdminPendingConfig,
} from './titanShopService.js';
import { getShopSettings } from './titanShopSettingsService.js';
import {
  provisionConfig,
  isPasargadConfigured,
  normalizeVolumeLabel,
} from './pasargadService.js';

function getImageAttachments(message) {
  return [...message.attachments.values()]
    .filter((attachment) => {
      const contentType = attachment.contentType || '';
      return contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(attachment.url || '');
    });
}

function buildReviewRow(guildId, channelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`titan_shop_approve:${guildId}:${channelId}`)
      .setLabel('✅ تایید')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`titan_shop_reject:${guildId}:${channelId}`)
      .setLabel('❌ تایید نیست')
      .setStyle(ButtonStyle.Danger),
  );
}

/**
 * Called for every guild message. If it is a receipt image posted in a shop
 * ticket channel, forward it to the configured admins for review.
 */
export async function handleShopReceiptMessage(message, client) {
  try {
    if (message.author.bot) {
      return false;
    }

    const ticket = await getShopTicket(client, message.guild.id, message.channel.id);
    if (!ticket) {
      return false;
    }

    if (ticket.status !== 'awaiting_receipt') {
      return true;
    }

    const images = getImageAttachments(message);
    if (images.length === 0) {
      await message.reply({
        embeds: [createEmbed({
          title: '⚠️ رسید تصویری بفرستید',
          description: 'لطفاً رسید پرداخت را به‌صورت **تصویر** در این چنل ارسال کنید.',
          color: 'warning',
        })],
      }).catch(() => {});
      return true;
    }

    const config = await getShopConfig(client, message.guild.id);
    const settings = await getShopSettings(client);

    // AUTO MODE: when the shop is in auto mode and Pasargad is configured,
    // skip admin review and auto-approve + provision the config.
    if (settings.mode === 'auto') {
      const result = await handleAutoProvision(client, message, ticket, settings);
      if (result === 'handled') {
        return true;
      }
      // If auto provisioning failed (e.g. API not configured), fall through to manual review.
    }

    const adminIds = await getShopAdminsNoInteraction(client, message.guild, config);
    if (adminIds.length === 0) {
      await message.reply({
        embeds: [createEmbed({
          title: '⚠️ ادمین تنظیم نشده',
          description: 'هیچ ادمینی برای تأیید رسیدها در این سرور تنظیم نشده است. با مدیر سرور در ارتباط باشید.',
          color: 'error',
        })],
      }).catch(() => {});
      return true;
    }

    const reviewEmbed = createEmbed({
      title: '🧾 رسید جدید برای بررسی',
      description:
        `کاربر <@${ticket.userId}> برای **${ticket.planLabel}** (` +
        `${ticket.price}) رسید پرداخت ارسال کرده است.\n\n` +
        'آیا پرداخت تأیید می‌شود؟',
      color: 'warning',
      fields: [
        { name: 'کاربر', value: `<@${ticket.userId}>`, inline: true },
        { name: 'تعرفه', value: ticket.planLabel, inline: true },
        { name: 'مبلغ', value: ticket.price, inline: true },
      ],
    });

    const files = images.map((attachment) => {
      return new AttachmentBuilder(attachment.url, {
        name: attachment.name || `receipt-${Date.now()}.png`,
      });
    });

    let sentToAny = false;
    for (const adminId of adminIds) {
      try {
        const user = await client.users.fetch(adminId);
        await user.send({
          embeds: [reviewEmbed],
          files,
          components: [buildReviewRow(message.guild.id, message.channel.id)],
        });
        sentToAny = true;
      } catch (err) {
        logger.warn('Could not DM shop admin receipt', {
          adminId,
          guildId: message.guild.id,
          error: err.message,
        });
      }
    }

    if (!sentToAny) {
      await message.reply({
        embeds: [createEmbed({
          title: '⚠️ ارسال به ادمین ممکن نشد',
          description: 'در حال حاضر امکان ارسال رسید به ادمین وجود ندارد. لطفاً بعداً تلاش کنید.',
          color: 'error',
        })],
      }).catch(() => {});
      return true;
    }

    await message.reply({
      embeds: [infoEmbed('📤 رسید ارسال شد', `رسید شما برای بررسی به مدیر ارسال شد. نتیجه به‌زودی اعلام می‌شود.`)],
    }).catch(() => {});

    logger.info('Shop receipt forwarded to admins', {
      guildId: message.guild.id,
      channelId: message.channel.id,
      userId: message.author.id,
      imageCount: images.length,
    });

    return true;
  } catch (error) {
    logger.error('handleShopReceiptMessage failed', {
      error: error.message,
      stack: error.stack,
      guildId: message.guild?.id,
      channelId: message.channel?.id,
    });
    return false;
  }
}

/**
 * Auto mode: verify Pasargad is configured, provision a config for the buyer,
 * mark the ticket approved/delivered, and send the config into the ticket channel.
 * @returns {'handled'|'fallthrough'}
 */
async function handleAutoProvision(client, message, ticket, settings) {
  try {
    if (!isPasargadConfigured(settings.pasargad)) {
      logger.warn('Shop is in auto mode but Pasargad API is not configured', {
        guildId: message.guild.id,
        channelId: message.channel.id,
      });
      await message.reply({
        embeds: [createEmbed({
          title: '⚠️ تنظیم خودکار کامل نیست',
          description: 'فروشگاه در حالت خودکار است اما کلید API پاسارگاد هنوز در داشبورد تنظیم نشده. لطفاً با مدیر تماس بگیرید.',
          color: 'warning',
        })],
      }).catch(() => {});
      return 'fallthrough';
    }

    await message.reply({
      embeds: [infoEmbed('⚙️ در حال ساخت کانفیگ', 'رسید شما دریافت شد. در حال ساخت خودکار کانفیگ…')],
    }).catch(() => {});

    const volumeGb = normalizeVolumeLabel(ticket.plan);
    const result = await provisionConfig(settings.pasargad, {
      username: `u_${ticket.userId}`,
      volumeGb,
      durationDays: 30,
    });

    if (!result.success || !result.config) {
      ticket.status = 'approved';
      await saveShopTicket(client, message.guild.id, ticket);
      await message.reply({
        embeds: [createEmbed({
          title: '❌ خطا در ساخت کانفیگ',
          description: `متأسفانه ساخت خودکار کانفیگ با خطا مواجه شد.\n${result.error || 'خطای نامشخص'}\nلطفاً با مدیر تماس بگیرید.`,
          color: 'error',
        })],
      }).catch(() => {});
      logger.error('Auto provision failed', { error: result.error, userId: message.author.id });
      return 'handled';
    }

    ticket.status = 'delivered';
    ticket.provisionedAt = new Date().toISOString();
    ticket.configId = result.userId || result.subId || null;
    await saveShopTicket(client, message.guild.id, ticket);

    await message.channel.send({
      embeds: [successEmbed(
        '🎉 کانفیگ شما آماده است',
        `**تعرفه:** ${ticket.planLabel}\n\n` +
        '**کانفیگ:**\n```\n' + result.config + '\n```',
      )],
    }).catch(() => {});

    logger.info('Auto provision delivered config', {
      guildId: message.guild.id,
      channelId: message.channel.id,
      userId: message.author.id,
      plan: ticket.plan,
    });

    return 'handled';
  } catch (error) {
    logger.error('handleAutoProvision failed', {
      error: error.message,
      stack: error.stack,
      guildId: message.guild?.id,
      channelId: message.channel?.id,
    });
    return 'fallthrough';
  }
}

/**
 * Called for every DM message. If the sender is an admin that approved a
 * purchase, forward the config text to the buyer's ticket channel.
 * Also greets users that purchase a plan directly in the ticket channel.
 */
export async function handleShopDirectMessage(message, client) {
  try {
    if (message.author.bot) {
      return;
    }

    // If a self-service purchase flow is open for this user in DMs, we do not
    // need to send anything; the plan is selected inside the guild panel.
    const pending = await getAdminPendingConfig(client, message.author.id);
    if (!pending || !pending.guildId || !pending.channelId) {
      return;
    }

    const guild = client.guilds.cache.get(pending.guildId);
    if (!guild) {
      return;
    }

    const channel = guild.channels.cache.get(pending.channelId)
      || (await guild.channels.fetch(pending.channelId).catch(() => null));
    if (!channel) {
      await clearAdminPendingConfig(client, message.author.id);
      return;
    }

    const text = (message.content || '').trim();
    if (!text) {
      await message.reply({
        embeds: [createEmbed({
          title: '⚠️ متن خالی',
          description: 'لطفاً متن کانفیگ را بنویسید و ارسال کنید.',
          color: 'warning',
        })],
      }).catch(() => {});
      return;
    }

    await channel.send({
      embeds: [successEmbed(
        '🎉 کانفیگ شما آماده است',
        `**تعرفه:** ${pending.planLabel || 'نامشخص'}\n\n` +
        '**کانفیگ:**\n' + '```\n' + text + '\n```',
      )],
    });

    await clearAdminPendingConfig(client, message.author.id);

    const ticket = await getShopTicket(client, pending.guildId, pending.channelId);
    if (ticket) {
      ticket.status = 'delivered';
      ticket.deliveredAt = new Date().toISOString();
      await saveShopTicket(client, pending.guildId, ticket);
    }

    await message.reply({
      embeds: [successEmbed('✅ ارسال شد', 'کانفیگ برای کاربر ارسال شد.')],
    }).catch(() => {});

    logger.info('Shop config delivered to user', {
      guildId: pending.guildId,
      channelId: pending.channelId,
      adminId: message.author.id,
    });
  } catch (error) {
    logger.error('handleShopDirectMessage failed', {
      error: error.message,
      stack: error.stack,
      userId: message.author?.id,
    });
  }
}