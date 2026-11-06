// AdsPower local API: mỗi account một profile riêng (fingerprint riêng), chạy headed.
import { ADS_API, chromium } from './config.mjs';

async function call(route, { method = 'GET', body } = {}) {
  const res = await fetch(`${ADS_API}${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (json.code !== 0) throw new Error(`AdsPower ${route}: ${json.code} ${json.msg || ''}`.trim());
  return json.data;
}

function proxyConfig(proxyUrl) {
  if (!proxyUrl) return { proxy_soft: 'no_proxy' };
  const url = new URL(proxyUrl);
  return {
    proxy_soft: 'other',
    proxy_type: 'http',
    proxy_host: url.hostname,
    proxy_port: Number(url.port) || 7777,
    proxy_user: decodeURIComponent(url.username),
    proxy_password: decodeURIComponent(url.password),
  };
}

export async function createProfile(name, proxyUrl = '') {
  const data = await call('/api/v1/user/create', {
    method: 'POST',
    body: {
      name,
      group_id: '0',
      domain_name: 'oxylabs.io',
      fingerprint_config: { automatic_timezone: '1', language: ['en-US'] },
      user_proxy_config: proxyConfig(proxyUrl),
    },
  });
  return data.id;
}

export async function startProfile(userId) {
  const data = await call(`/api/v1/browser/start?user_id=${encodeURIComponent(userId)}&open_tabs=0&ip_tab=0`);
  const ws = data.ws?.puppeteer || data.ws?.selenium;
  if (!ws) throw new Error('AdsPower không trả WebSocket CDP');
  return ws;
}

export async function stopProfile(userId) {
  await call(`/api/v1/browser/stop?user_id=${encodeURIComponent(userId)}`).catch(() => {});
}

// Mở profile và trả page đã sẵn sàng.
export async function openProfile(userId) {
  const ws = await startProfile(userId);
  const browser = await chromium.connectOverCDP(ws);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.newPage());
  return { browser, context, page };
}
