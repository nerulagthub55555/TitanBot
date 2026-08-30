// pasargadService.js — API client for the Pasargad panel.
// Based on the official PasarGuard REST API (see src of pasarguard/panel):
//   - Auth: X-Api-Key header (or `Authorization: apikey <key>`) — NOT Bearer.
//   - Create user: POST /api/user  -> 200/201 with a UserResponse that includes
//     `subscription_url` (the link we hand to the buyer as their config).
//   - data_limit is in bytes (10GB = 10737418240); 0 == unlimited.
//   - expire is a UTC datetime string, or 0 for unlimited.

import { logger } from '../utils/logger.js';

const GB = 1024 * 1024 * 1024;

export function normalizeVolumeLabel(planValue) {
  // Map stored plan values to a stable volume in GB.
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

function volumeBytes(volumeGb) {
  return Math.round(Number(volumeGb || 0) * GB);
}

function expireUtc(durationDays) {
  const days = Math.max(1, Math.round(Number(durationDays || 30)));
  const ms = Date.now() + days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

function sanitizeUsername(raw) {
  const cleaned = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');
  // Usernames must be 3..32 chars (a-z, 0-9, underscore).
  if (cleaned.length < 3) {
    return `u_${cleaned}`.padEnd(3, '0').slice(0, 32);
  }
  return cleaned.slice(0, 32);
}

/**
 * Create an HTTP request helper against the Pasargad panel.
 * Expects settings.pasargad = { apiKey, baseUrl }.
 */
function buildClient(pasargad) {
  if (!pasargad || !pasargad.apiKey || !pasargad.baseUrl) {
    return null;
  }

  const apiKey = String(pasargad.apiKey);
  return {
    baseUrl: String(pasargad.baseUrl).replace(/\/+$/, ''),
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
      Authorization: `apikey ${apiKey}`,
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
    if (res.status === 409) {
      throw new Error(`این نام کاربری از قبل در پنل وجود دارد (${res.status}).`);
    }
    throw new Error(`Pasargad API ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  }

  return data;
}

/**
 * Shared body builder for creating a user on the Pasargad panel.
 */
function buildCreateBody(payload) {
  return {
    username: sanitizeUsername(payload.username),
    status: 'active',
    data_limit: volumeBytes(payload.volumeGb),
    data_limit_reset_strategy: 'no_reset',
    expire: expireUtc(payload.durationDays),
    note: payload.note || null,
  };
}

/**
 * Extract the subscription link (config) from a UserResponse-style object.
 */
function extractConfig(data) {
  return (
    data?.subscription_url
    || data?.subscriptionUrl
    || data?.sub_url
    || data?.link
    || data?.url
    || null
  );
}

/**
 * Provision a user + config on the Pasargad panel.
 * @param {object} pasargad settings.pasargad
 * @param {object} payload { username, volumeGb, durationDays, note }
 * @returns {Promise<{ success: boolean, config?: string, userId?: number|null, raw?: object, error?: string }>}
 */
export async function provisionConfig(pasargad, payload) {
  const client = buildClient(pasargad);
  if (!client) {
    return { success: false, error: 'Pasargad API key or URL is not configured.' };
  }

  try {
    const data = await request(client, 'POST', '/api/user', buildCreateBody(payload));

    const config = extractConfig(data);
    const userId = data?.id ?? null;

    if (!config) {
      logger.warn('Pasargad create did not return a subscription url', { raw: data });
      return {
        success: false,
        userId,
        error: 'پاسخ پنل لینک اشتراک (subscription_url) را برنگرداند.',
        raw: data,
      };
    }

    return { success: true, userId, config, raw: data };
  } catch (error) {
    logger.error('Pasargad provisionConfig failed', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Create a test (small/quick) config on the panel.
 */
export async function provisionTestConfig(pasargad, payload) {
  const client = buildClient(pasargad);
  if (!client) {
    return { success: false, error: 'Pasargad API key or URL is not configured.' };
  }

  try {
    const data = await request(client, 'POST', '/api/user', {
      ...buildCreateBody(payload),
      username: sanitizeUsername(payload.username || `test_${Date.now()}`),
      data_limit: volumeBytes(payload.volumeGb || 0.1),
      expire: expireUtc(payload.durationDays || 1),
      note: (payload.note || 'Test account').slice(0, 500),
    });

    const config = extractConfig(data);
    const userId = data?.id ?? null;

    if (!config) {
      return {
        success: false,
        userId,
        error: 'پاسخ پنل لینک اشتراک (subscription_url) را برنگرداند.',
        raw: data,
      };
    }

    return { success: true, userId, config, raw: data };
  } catch (error) {
    logger.error('Pasargad provisionTestConfig failed', { error: error.message });
    return { success: false, error: error.message };
  }
}

export function isPasargadConfigured(pasargad) {
  return Boolean(pasargad && pasargad.apiKey && pasargad.baseUrl);
}

/**
 * Check that the configured API key + base URL can authenticate against the
 * panel. Uses a lightweight read endpoint (users simple list) so bad keys or
 * unreachable hosts fail fast without creating any data.
 * @param {{apiKey: string, baseUrl: string}} pasargad
 * @returns {Promise<{ ok: boolean, status?: number, detail?: string, error?: string }>}
 */
export async function testPasargadConnection(pasargad) {
  const client = buildClient(pasargad);
  if (!client) {
    return { ok: false, error: 'API Key و Address پنل را وارد کنید.' };
  }

  try {
    const data = await request(client, 'GET', '/api/users/simple?limit=1');
    return { ok: true, status: 200, detail: 'اتصال به پنل برقرار است و کلید API معتبر است.', raw: data };
  } catch (error) {
    const m = /Pasargad API GET (.*) -> (\d+)/.exec(error.message || '');
    return {
      ok: false,
      status: m ? Number(m[2]) : null,
      error: error.message || 'خطای نامشخص',
    };
  }
}
