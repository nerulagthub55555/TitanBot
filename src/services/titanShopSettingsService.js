// titanShopSettingsService.js — dashboard settings for the NERULA config shop.

import { logger } from '../utils/logger.js';

export const SHOP_SETTINGS_KEY = 'titanshop:settings';

export const DEFAULT_SHOP_SETTINGS = {
  mode: 'manual', // 'manual' | 'auto'
  pasargad: null, // { apiKey, baseUrl, panelUrl }
  webPassword: null,
  testEnabled: false,
};

export async function getShopSettings(client) {
  try {
    const raw = await client?.db?.get(SHOP_SETTINGS_KEY, null);
    return { ...DEFAULT_SHOP_SETTINGS, ...(raw || {}) };
  } catch (error) {
    logger.error('Error reading titan shop settings:', { error: error.message });
    return { ...DEFAULT_SHOP_SETTINGS };
  }
}

export async function setShopSettings(client, settings) {
  try {
    await client.db.set(SHOP_SETTINGS_KEY, settings);
    return true;
  } catch (error) {
    logger.error('Error saving titan shop settings:', { error: error.message });
    return false;
  }
}

export async function updateShopSettings(client, patch) {
  const current = await getShopSettings(client);
  const next = { ...current, ...patch };
  await setShopSettings(client, next);
  return next;
}
