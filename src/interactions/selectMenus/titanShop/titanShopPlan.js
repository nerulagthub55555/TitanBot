// titanShopPlan.js — select menu handler that shows payment info for the chosen plan.

import { MessageFlags } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';
import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';
import {
  getShopPlan,
  getShopConfig,
  SHOP_CARD_NUMBER,
  SHOP_CARD_HOLDER,
} from '../../../services/titanShopService.js';
import {
  SHOP_HEADER,
  buildPaidCancelButtons,
} from '../../../services/titanShopUI.js';

export default {
  name: 'titan_shop_plan',

  async execute(interaction, client) {
    try {
      const planValue = interaction.values?.[0];
      const plan = getShopPlan(planValue);
      if (!plan) {
        return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'تعرفه انتخاب‌شده معتبر نیست.' });
      }

      const config = await getShopConfig(client, interaction.guildId);
      if (!config.panelChannelId) {
        return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'پنل خرید در این سرور تنظیم نشده است.' });
      }

      const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferred) return;

      const embed = createEmbed({
        title: SHOP_HEADER,
        description:
          'برای تکمیل خرید، مبلغ را به کارت زیر واریز کنید و سپس روی **پرداخت شد** بزنید.\n' +
          'رسید پرداخت را در چنلی که ساخته می‌شود ارسال کنید.',
        color: 'warning',
        fields: [
          { name: 'تعرفه انتخابی', value: plan.label, inline: true },
          { name: 'مبلغ', value: plan.price, inline: true },
          { name: 'شماره کارت', value: SHOP_CARD_NUMBER },
          { name: 'به نام', value: SHOP_CARD_HOLDER },
        ],
      });

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [embed],
        components: [buildPaidCancelButtons(plan.value)],
      });
    } catch (error) {
      logger.error('titan_shop_plan select failed', { error: error.message, guildId: interaction.guildId });
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'خطایی رخ داد. دوباره تلاش کنید.' });
    }
  },
};