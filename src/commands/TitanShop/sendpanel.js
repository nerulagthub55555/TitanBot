import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import {
  getShopConfig,
  setShopConfig,
  SHOP_CARD_NUMBER,
  SHOP_CARD_HOLDER,
} from '../../services/titanShopService.js';
import {
  buildPlanFields,
  buildStepsList,
} from '../../services/titanShopUI.js';

export const SHOP_BUY_BUTTON_ID = 'titan_shop_buy';

export default {
  data: new SlashCommandBuilder()
    .setName('sendpanel')
    .setDescription('تنظیم پنل خرید کانفیگ ربات نرولا در سرور')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addChannelOption((option) =>
      option
        .setName('panel_channel')
        .setDescription('چنلی که پنل خرید در آن ارسال می‌شود')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .addRoleOption((option) =>
      option
        .setName('admin_role')
        .setDescription('نقشی که مدیران فروشگاه هستند (رسیدها به آن‌ها ارسال می‌شود)')
        .setRequired(false),
    )
    .addUserOption((option) =>
      option
        .setName('admin_user')
        .setDescription('کاربری که مدیر فروشگاه است (رسیدها به او ارسال می‌شود)')
        .setRequired(false),
    ),
  category: 'TitanShop',

  async execute(interaction, config, client) {
    const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
    if (!deferred) {
      return;
    }

    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'فقط ادمین‌های سرور می‌توانند از این دستور استفاده کنند.' });
    }

    const panelChannel = interaction.options.getChannel('panel_channel');
    const adminRole = interaction.options.getRole('admin_role');
    const adminUser = interaction.options.getUser('admin_user');

    const existingConfig = await getShopConfig(client, interaction.guildId);
    if (existingConfig.panelChannelId) {
      const channel = interaction.guild.channels.cache.get(existingConfig.panelChannelId);
      return await replyUserError(interaction, {
        type: ErrorTypes.UNKNOWN,
        message: `این سرور قبلاً پنل خرید دارد (${channel ? `در <#${existingConfig.panelChannelId}>` : 'در چنلی که حذف شده'}).\n\nبرای تنظیم مجدد، ابتدا پنل قبلی را حذف کرده و دوباره این دستور را اجرا کنید.`,
      });
    }

    try {
const embed = createEmbed({
        title: 'خرید کانفیگ از ربات نرولا',
        description:
          'برای مشاهده تعرفه‌ها و خرید، روی دکمه زیر کلیک کنید.\n\n' +
          buildStepsList(),
        color: 'primary',
        fields: buildPlanFields(),
      });

      const buyButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(SHOP_BUY_BUTTON_ID)
          .setLabel('🛒 خرید کانفیگ')
          .setStyle(ButtonStyle.Primary),
      );

      const sentPanel = await panelChannel.send({
        embeds: [embed],
        components: [buyButton],
      });

      const shopConfig = {
        panelChannelId: panelChannel.id,
        panelMessageId: sentPanel?.id || null,
        adminRoleId: adminRole ? adminRole.id : null,
        adminUserId: adminUser ? adminUser.id : null,
      };

      await setShopConfig(client, interaction.guildId, shopConfig);

      let successMessage = `پنل خرید با موفقیت در ${panelChannel} ارسال شد.`;
      if (adminRole) {
        successMessage += `\nاعضای نقش ${adminRole} مدیر فروشگاه هستند و رسیدها را دریافت می‌کنند.`;
      }
      if (adminUser) {
        successMessage += `\n${adminUser} مدیر فروشگاه است و رسیدها را دریافت می‌کند.`;
      }
      if (!adminRole && !adminUser) {
        successMessage += '\n⚠️ هیچ ادمینی انتخاب نشده است. رسیدها دریافت نمی‌شوند! برای افزودن ادمین، پنل را حذف و دوباره با `/sendpanel` تنظیم کنید.';
      }

      successMessage += `\n\n**کارت:** \`${SHOP_CARD_NUMBER}\`\n**به نام:** ${SHOP_CARD_HOLDER}`;

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [successEmbed('پنل خرید تنظیم شد', successMessage)],
      });

      logger.info('Titan shop panel set up', {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        panelChannelId: panelChannel.id,
        adminRoleId: adminRole?.id,
        adminUserId: adminUser?.id,
        commandName: 'sendpanel',
      });
    } catch (error) {
      logger.error('Titan shop panel setup failed', {
        error: error.message,
        stack: error.stack,
        guildId: interaction.guildId,
        commandName: 'sendpanel',
      });
      return await replyUserError(interaction, {
        type: ErrorTypes.UNKNOWN,
        message: 'ارسال پنل یا ذخیره تنظیمات با خطا مواجه شد. مطمئن شوید ربات اجازه ارسال پیام در چنل هدف را دارد.',
      });
    }
  },
};