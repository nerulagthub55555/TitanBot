// titanShopUI.js — shared UI components and text for the NERULA shop.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import { SHOP_PLANS } from './titanShopService.js';

export const SHOP_HEADER = 'خرید کانفیگ از ربات نرولا';
export const SHOP_BUY_CUSTOM_ID = 'titan_shop_buy';
export const SHOP_TEST_CUSTOM_ID = 'titan_shop_test';

export function buildShopActionRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(SHOP_BUY_CUSTOM_ID)
      .setLabel('خرید کانفیگ')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(SHOP_TEST_CUSTOM_ID)
      .setLabel('تست')
      .setStyle(ButtonStyle.Secondary),
  );
}

export function buildPlanSelectRow() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('titan_shop_plan')
    .setPlaceholder('تعرفه موردنظر را انتخاب کنید');

  for (const plan of Object.values(SHOP_PLANS)) {
    select.addOptions({
      label: plan.label,
      description: plan.price,
      value: plan.value,
    });
  }

  return new ActionRowBuilder().addComponents(select);
}

export function buildPaidCancelButtons(planValue) {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`titan_shop_paid:${planValue}`)
        .setLabel('پرداخت شد')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`titan_shop_cancel:${planValue}`)
        .setLabel('لغو')
        .setStyle(ButtonStyle.Secondary),
    );
}

export function buildPlanFields() {
  return Object.values(SHOP_PLANS).map((plan) => ({
    name: plan.label,
    value: plan.price,
    inline: true,
  }));
}

export function buildStepsList() {
  return (
    '**مراحل خرید:**\n' +
    '1. انتخاب تعرفه\n' +
    '2. پرداخت به کارت مشخص‌شده\n' +
    '3. ارسال رسید پرداخت\n\n' +
    'پس از تأیید، کانفیگ برای شما ارسال می‌شود.'
  );
}