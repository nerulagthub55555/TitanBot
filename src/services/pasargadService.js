// pasargadService.js — API client for the PasargadVPN panel.
// Structural skeleton. Exact endpoints/responses vary by panel version;
// this reads the API key from settings and provides clean helpers that the
// auto-provision flow will call. Fill in exact paths once the API is verified.

import { logger } from '../utils/logger.js';

export function normalizeVolumeLabel(planValue) {
  // Map stored plan values to a stable yearly volume in GB.
  switch (planValue) {
    case '50gb':
      return 50;
    case '20gb':
      return 20;
    case '10gb':
    default:
      return 10;
  }
}

/**
 * Create an HTTP request helper against the Pasargad panel.
 * Expects settings.pasargad = { apiKey, baseUrl }.
 */
function buildClient(pasargad) {
  if (!pasargad || !pasargad.apiKey || !pasargad.baseUrl) {
    return null;
  }

  return {
    baseUrl: String(pasargad.baseUrl).replace(/\/+$/, ''),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pasargad.apiKey}`,
    },
  };
}

async function request(client, method, path, body = null) {
  const url = `${client.baseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: client.headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`Pasargad API ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  }

  return data;
}

/**
 * Provision a user + config on the Pasargad panel.
 * @param {object} pasargad settings.pasargad
 * @param {object} payload { username, volumeGb, durationDays }
 * @returns {Promise<{ success: boolean, config?: string, raw?: object, error?: string }>}
 */
export async function provisionConfig(pasargad, payload) {
  const client = buildClient(pasargad);
  if (!client) {
    return { success: false, error: 'Pasargad API key or URL is not configured.' };
  }

  try {
    // NOTE: Adjust path/body to match the actual Pasargad panel API.
    const data = await request(client, 'POST', '/api/user/create', {
      username: payload.username,
      volume_gb: payload.volumeGb,
      expire_days: payload.durationDays,
      active: true,
    });

    const config = data?.config
      || data?.link
      || data?.url
      || (typeof data === 'string' ? data : null);
    const userId = data?.id || data?.user_id || null;
    const subId = data?.subscription_id || data?.subId || null;

    return { success: true, userId, subId, config, raw: data };
  } catch (error) {
    logger.error('Pasargad provisionConfig failed', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Create a test (small/quick) config if the panel supports it.
 */
export async function provisionTestConfig(pasargad, payload) {
  const client = buildClient(pasargad);
  if (!client) {
    return { success: false, error: 'Pasargad API key or URL is not configured.' };
  }

  try {
    const data = await request(client, 'POST', '/api/user/create', {
      username: payload.username,
      volume_gb: payload.volumeGb || 0.1,
      expire_days: payload.durationDays || 1,
      test: true,
      active: true,
    });

    const config = data?.config || data?.link || data?.url || null;
    return { success: true, config, raw: data };
  } catch (error) {
    logger.error('Pasargad provisionTestConfig failed', { error: error.message });
    return { success: false, error: error.message };
  }
}

export function isPasargadConfigured(pasargad) {
  return Boolean(pasargad && pasargad.apiKey && pasargad.baseUrl);
}
