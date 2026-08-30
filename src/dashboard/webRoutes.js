// webRoutes.js — dashboard routes for the NERULA config shop (served by the bot's web server).

import { Router } from 'express';
import {
  getShopSettings,
  updateShopSettings,
} from '../services/titanShopSettingsService.js';
import { getShopConfig, listShopTickets } from '../services/titanShopService.js';
import { isPasargadConfigured } from '../services/pasargadService.js';
import { logger } from '../utils/logger.js';

function isAuthorized(req, settings, envPassword) {
  const provided = req.headers['x-admin-password'] || req.query.pass || null;
  const expected = settings.webPassword || envPassword;
  return Boolean(expected && provided && provided === expected);
}

const router = Router();

router.get('/dashboard', async (req, res) => {
  const settings = await getShopSettings(req.client);
  const envPassword = process.env.SHOP_DASHBOARD_PASSWORD || null;
  const authorized = isAuthorized(req, settings, envPassword);

  res.type('html').send(renderDashboard({ settings, authorized, envPassword }));
});

// JSON API used by the page.
router.get('/api/shop/dashboard', async (req, res) => {
  const settings = await getShopSettings(req.client);
  const envPassword = process.env.SHOP_DASHBOARD_PASSWORD || null;
  if (!isAuthorized(req, settings, envPassword)) {
    return res.status(403).json({ error: 'Unauthorized. Provide correct access password.' });
  }

  const configs = [];
  const guildTickets = await gatherTickets(req.client);

  return res.json({
    settings: {
      mode: settings.mode,
      testEnabled: settings.testEnabled,
      pasargadConfigured: isPasargadConfigured(settings.pasargad),
      hasWebPassword: Boolean(settings.webPassword || envPassword),
    },
    guilds: configs,
    tickets: guildTickets,
  });
});

router.post('/api/shop/settings', async (req, res) => {
  const settings = await getShopSettings(req.client);
  const envPassword = process.env.SHOP_DASHBOARD_PASSWORD || null;
  if (!isAuthorized(req, settings, envPassword)) {
    return res.status(403).json({ error: 'Unauthorized.' });
  }

  const body = req.body || {};

  if (body.password) {
    await updateShopSettings(req.client, { webPassword: body.password });
  }

  if (typeof body.mode === 'string' && ['manual', 'auto'].includes(body.mode)) {
    await updateShopSettings(req.client, { mode: body.mode });
  }

  if (typeof body.testEnabled === 'boolean') {
    await updateShopSettings(req.client, { testEnabled: body.testEnabled });
  }

  if (typeof body.pasargadApiKey === 'string' || typeof body.pasargadUrl === 'string') {
    const current = await getShopSettings(req.client);
    await updateShopSettings(req.client, {
      pasargad: {
        apiKey: body.pasargadApiKey || current.pasargad?.apiKey || '',
        baseUrl: body.pasargadUrl || current.pasargad?.baseUrl || '',
        panelUrl: body.panelUrl || current.pasargad?.panelUrl || '',
      },
    });
  }

  const updated = await getShopSettings(req.client);
  res.json({ ok: true, settings: { mode: updated.mode, testEnabled: updated.testEnabled, pasargadConfigured: isPasargadConfigured(updated.pasargad) } });
});

router.post('/api/shop/approve', async (req, res) => {
  const settings = await getShopSettings(req.client);
  const envPassword = process.env.SHOP_DASHBOARD_PASSWORD || null;
  if (!isAuthorized(req, settings, envPassword)) {
    return res.status(403).json({ error: 'Unauthorized.' });
  }

  const { guildId, channelId } = req.body || {};
  if (!guildId || !channelId) {
    return res.status(400).json({ error: 'guildId and channelId required.' });
  }

  const guild = req.client.guilds.cache.get(guildId);
  if (!guild) {
    return res.status(404).json({ error: 'Guild not found.' });
  }
  const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel) {
    return res.status(404).json({ error: 'Ticket channel not found.' });
  }

  await channel.send({
    embeds: [{
      title: '✅ پرداخت تأیید شد',
      description: 'رسید شما تأیید شد. کانفیگ به‌زودی برای شما ارسال می‌شود.',
      color: 0x23a55a,
    }],
  }).catch(() => {});

  res.json({ ok: true });
});

async function gatherTickets(client) {
  const result = [];
  for (const [guildId, guild] of client.guilds.cache) {
    const tickets = await listShopTickets(client, guildId).catch(() => []);
    for (const t of tickets) {
      result.push({
        guildId,
        guildName: guild.name,
        channelId: t.channelId,
        userId: t.userId,
        plan: t.plan,
        planLabel: t.planLabel,
        price: t.price,
        status: t.status,
        createdAt: t.createdAt,
      });
    }
  }
  return result;
}

function renderDashboard({ settings, authorized, envPassword }) {
  const passwordHint = envPassword ? '(env-based)' : settings.webPassword ? '(saved in dashboard)' : '(not set)';
  if (!authorized) {
    return `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ورود</title>
    <style>body{font-family:Tahoma,sans-serif;background:#1e1f22;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
    .card{background:#2b2d31;padding:30px;border-radius:12px;width:340px;box-shadow:0 10px 30px rgba(0,0,0,.4)}
    input{width:100%;padding:10px;box-sizing:border-box;margin:10px 0;border-radius:6px;border:1px solid #3f4147;background:#1e1f22;color:#eee}
    button{width:100%;padding:11px;background:#5865f2;color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer}</style></head>
    <body><div class="card"><h2>ورود به پنل</h2><p style="color:#aaa">نیاز به رمز دسترسی دارد</p>
    <input type="password" id="p" placeholder="رمز دسترسی">
    <button onclick="location.href='/dashboard?pass='+encodeURIComponent(document.getElementById('p').value)">ورود</button>
    <p style="font-size:12px;color:#888">${passwordHint}</p></div></body></html>`;
  }

  return `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>داشبورد فروشگاه</title>
  <style>
    *{box-sizing:border-box}body{font-family:Tahoma,sans-serif;background:#1e1f22;color:#eee;margin:0;padding:20px}
    h1{font-size:20px}label{display:block;margin:10px 0 4px;color:#ccc;font-size:13px}
    input,select,button{font-size:14px;border-radius:6px;border:1px solid #3f4147;background:#2b2d31;color:#eee;padding:9px}
    input{width:100%;max-width:420px}
    .row{display:flex;gap:16px;flex-wrap:wrap;margin-top:8px}
    .card{background:#2b2d31;padding:18px;border-radius:12px;margin-top:16px}
    .card h3{margin:0 0 10px;font-size:15px;color:#fff}
    .btn{padding:9px 16px;cursor:pointer;margin-top:6px}
    .btn-primary{background:#5865f2}.btn-success{background:#23a55a}.btn-danger{background:#da373c}.btn-secondary{background:#4e5058}
    table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
    th,td{text-align:right;padding:8px;border-bottom:1px solid #3f4147}
    .tag{padding:2px 8px;border-radius:10px;font-size:12px}
    .tag-awaiting_receipt{background:#faa61a;color:#000}.tag-approved{background:#23a55a}.tag-rejected{background:#da373c}.tag-delivered{background:#5865f2}
    .note{color:#aaa;font-size:12px}
    .switch{display:flex;align-items:center;gap:8px}
  </style></head><body>
  <h1>🗂️ داشبورد فروشگاه کانфиگ</h1>
  <div class="row">
    <div class="card" style="flex:1;min-width:300px">
      <h3>تنظیمات فروشگاه</h3>
      <label>روش پردازش خرید</label>
      <select id="mode"><option value="manual">تایید دستی</option><option value="auto">تایید و ساخت خودکار</option></select>
      <div class="switch"><input type="checkbox" id="testOn" style="width:auto"><label for="testOn" style="display:inline;margin:0">فعال کردن تست (۱۰۰MB) برای هر کاربر</label></div>
      <h3 style="margin-top:18px">🔑 پنل پاسارگاد (برای ساخت خودکار)</h3>
      <label>API Key</label><input id="apiKey" placeholder="کلید API پنل پاسارگاد">
      <label>Base URL (پنل)</label><input id="apiUrl" placeholder="https://panel.example.com">
      <br>
      <button class="btn btn-primary" onclick="save()">ذخیره تنظیمات</button>
      <div id="saveMsg" class="note" style="margin-top:8px"></div>
    </div>
  </div>
  <div class="card">
    <h3>خریدها / تیکت‌ها</h3>
    <table><thead><tr><th>سرور</th><th>کاربر</th><th>تعرفه</th><th>مبلغ</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody id="rows"></tbody></table>
  </div>
  <script>
    const PASS = ${JSON.stringify(new URLSearchParams(location.search).get('pass') || '')};
    async function api(path, opts){opts=opts||{};opts.headers=opts.headers||{};opts.headers['x-admin-password']=PASS;opts.headers['Content-Type']='application/json';const r=await fetch(path,opts);return r.json();}
    async function load(){
      const d=await api('/api/shop/dashboard');
      document.getElementById('mode').value=d.settings.mode;
      document.getElementById('testOn').checked=d.settings.testEnabled;
      const rows=d.tickets.map(t=>\`<tr><td>\${t.guildName||t.guildId}</td><td>\${t.userId}</td><td>\${t.planLabel}</td><td>\${t.price}</td><td><span class="tag tag-\${t.status}">\${t.status}</span></td>
        <td><button class="btn btn-success btn-xs" onclick="approve('\${t.guildId}','\${t.channelId}')">تایید</button>
        <button class="btn btn-secondary btn-xs" onclick="window.open('/dashboard?pass='+PASS,'_blank')">ارسال</button></td></tr>\`).join('');
      document.getElementById('rows').innerHTML=rows||'<tr><td colspan=6>تیکتی وجود ندارد</td></tr>';
    }
    async function save(){
      const body={mode:document.getElementById('mode').value,testEnabled:document.getElementById('testOn').checked,pasargadApiKey:document.getElementById('apiKey').value,pasargadUrl:document.getElementById('apiUrl').value};
      const d=await api('/api/shop/settings',{method:'POST',body:JSON.stringify(body)});
      document.getElementById('saveMsg').textContent=d.ok?'✅ ذخیره شد':'❌ خطا: '+JSON.stringify(d);
    }
    async function approve(g,c){const d=await api('/api/shop/approve',{method:'POST',body:JSON.stringify({guildId:g,channelId:c})});load();}
    load();
  </script></body></html>`;
}

export default router;
