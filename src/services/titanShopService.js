// titanShopService.js — data helpers for the NERULA config shop panel.

import { logger } from '../utils/logger.js';

export const SHOP_CONFIG_KEY = (guildId) => `guild:${guildId}:titanshop:config`;
export const SHOP_TICKET_KEY = (guildId, channelId) => `guild:${guildId}:titanshop:ticket:${channelId}`;
export const SHOP_TICKET_PREFIX = (guildId) => `guild:${guildId}:titanshop:ticket:`;
export const SHOP_ADMIN_PENDING_KEY = (adminId) => `titanshop:adminpending:${adminId}`;

export const SHOP_PLANS = {
  '10gb': { label: '۱۰ گیگ', price: '۱۰۰٬۰۰۰ تومان', value: '10gb' },
  '20gb': { label: '۲۰ گیگ', price: '۱۵۰٬۰۰۰ تومان', value: '20gb' },
  '50gb': { label: '۵۰ گیگ', price: '۲۵۰٬۰۰۰ تومان', value: '50gb' },
};

export const SHOP_CARD_NUMBER = '6104 3387 5956 2107';
export const SHOP_CARD_HOLDER = 'اهورا ارپناهی';

export function getShopPlan(value) {
  return SHOP_PLANS[value] || null;
}

export async function getShopConfig(client, guildId) {
  try {
    const raw = await client?.db?.get(SHOP_CONFIG_KEY(guildId), null);
    return raw || { panelChannelId: null, panelMessageId: null, adminRoleId: null, adminUserId: null };
  } catch (error) {
    logger.error('Error reading titan shop config:', { error: error.message, guildId });
    return { panelChannelId: null, panelMessageId: null, adminRoleId: null, adminUserId: null };
  }
}

export async function setShopConfig(client, guildId, config) {
  try {
    await client.db.set(SHOP_CONFIG_KEY(guildId), config);
    return true;
  } catch (error) {
    logger.error('Error saving titan shop config:', { error: error.message, guildId });
    return false;
  }
}

export async function getShopTicket(client, guildId, channelId) {
  try {
    return await client?.db?.get(SHOP_TICKET_KEY(guildId, channelId), null);
  } catch (error) {
    logger.error('Error reading titan shop ticket:', { error: error.message, guildId, channelId });
    return null;
  }
}

export async function saveShopTicket(client, guildId, ticket) {
  try {
    await client.db.set(SHOP_TICKET_KEY(guildId, ticket.channelId), ticket);
    return true;
  } catch (error) {
    logger.error('Error saving titan shop ticket:', { error: error.message, guildId, channelId: ticket.channelId });
    return false;
  }
}

export async function deleteShopTicket(client, guildId, channelId) {
  try {
    await client.db.delete(SHOP_TICKET_KEY(guildId, channelId));
    return true;
  } catch (error) {
    logger.error('Error deleting titan shop ticket:', { error: error.message, guildId, channelId });
    return false;
  }
}

export async function listShopTickets(client, guildId) {
  try {
    const keys = await client?.db?.list(SHOP_TICKET_PREFIX(guildId));
    if (!Array.isArray(keys)) {
      return [];
    }

    const tickets = [];
    for (const key of keys) {
      const ticket = await client.db.get(key, null).catch(() => null);
      if (ticket) {
        tickets.push(ticket);
      }
    }
    return tickets;
  } catch (error) {
    logger.error('Error listing titan shop tickets:', { error: error.message, guildId });
    return [];
  }
}

export async function getAdminPendingConfig(client, adminId) {
  try {
    return await client?.db?.get(SHOP_ADMIN_PENDING_KEY(adminId), null);
  } catch (error) {
    logger.error('Error reading admin pending config:', { error: error.message, adminId });
    return null;
  }
}

export async function setAdminPendingConfig(client, adminId, pending) {
  try {
    await client.db.set(SHOP_ADMIN_PENDING_KEY(adminId), pending);
    return true;
  } catch (error) {
    logger.error('Error saving admin pending config:', { error: error.message, adminId });
    return false;
  }
}

export async function clearAdminPendingConfig(client, adminId) {
  try {
    await client.db.delete(SHOP_ADMIN_PENDING_KEY(adminId));
    return true;
  } catch (error) {
    logger.error('Error clearing admin pending config:', { error: error.message, adminId });
    return false;
  }
}

export async function getShopAdmins(client, interaction) {
  const config = await getShopConfig(client, interaction.guildId);
  return collectShopAdminIds(client, interaction.guild, config);
}

export async function getShopAdminsNoInteraction(client, guild, config) {
  return collectShopAdminIds(client, guild, config);
}

async function collectShopAdminIds(client, guild, config) {
  const admins = [];

  if (!guild) {
    return admins;
  }

  if (config?.adminUserId) {
    admins.push(config.adminUserId);
  }

  if (config?.adminRoleId) {
    const role = guild.roles.cache.get(config.adminRoleId);
    if (role) {
      for (const member of role.members.values()) {
        if (!member.user.bot && !admins.includes(member.id)) {
          admins.push(member.id);
        }
      }
    }
  }

  return admins;
}