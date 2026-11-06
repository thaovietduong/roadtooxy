// Đọc mail qua Microsoft Graph bằng refresh token trong pool của roadtopre.
// Token xoay vòng được ghi lại vào pool để lần sau vẫn dùng được.
import fs from 'node:fs';
import { MAIL_POOL, sleep } from './config.mjs';

const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH = 'https://graph.microsoft.com/v1.0/me/mailFolders';
const SCOPE = 'https://graph.microsoft.com/.default offline_access';
const ACTIVATION_RE = /^https:\/\/dashboard\.oxylabs\.io\/activate-user\?/i;

export class MailError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

export function loadPool() {
  if (!fs.existsSync(MAIL_POOL)) throw new MailError(`Không thấy pool mail: ${MAIL_POOL}`, 'MAIL_POOL');
  return JSON.parse(fs.readFileSync(MAIL_POOL, 'utf8'));
}

export function savePool(pool) {
  const tmp = `${MAIL_POOL}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(pool, null, 1));
  fs.renameSync(tmp, MAIL_POOL);
}

export function pickMail(preferred) {
  const pool = loadPool();
  if (preferred) {
    const hit = pool.find((m) => m.email.toLowerCase() === preferred.toLowerCase());
    if (!hit) throw new MailError(`Mail ${preferred} không có trong pool`, 'MAIL_MISSING');
    return hit;
  }
  const free = pool.find((m) => m.status === 'available' && m.refreshToken && m.clientId);
  if (!free) throw new MailError('Pool không còn mail available', 'MAIL_EMPTY');
  return free;
}

export function markMail(email, { status, shop, reason }) {
  const pool = loadPool();
  const hit = pool.find((m) => m.email.toLowerCase() === email.toLowerCase());
  if (!hit) return;
  hit.status = status;
  hit.shop = shop;
  hit.reason = reason;
  hit.updated_at = new Date().toISOString();
  savePool(pool);
}

async function tokenFor(mail) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: mail.clientId,
      grant_type: 'refresh_token',
      refresh_token: mail.refreshToken,
      scope: SCOPE,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new MailError(`Token mailbox lỗi (${res.status}): ${data.error || 'unknown'}`, 'MAIL_AUTH');
  if (!data.access_token) throw new MailError('Graph không trả access_token', 'MAIL_PROTOCOL');
  if (data.refresh_token && data.refresh_token !== mail.refreshToken) {
    mail.refreshToken = data.refresh_token;
    const pool = loadPool();
    const hit = pool.find((m) => m.email.toLowerCase() === mail.email.toLowerCase());
    if (hit) { hit.refreshToken = data.refresh_token; hit.updated_at = new Date().toISOString(); savePool(pool); }
  }
  return data.access_token;
}

async function messages(mail, token, sinceIso) {
  const out = [];
  for (const folder of ['inbox', 'junkemail']) {
    const q = new URLSearchParams({
      $top: '25',
      $select: 'from,toRecipients,receivedDateTime,subject,body',
      $orderby: 'receivedDateTime desc',
      $filter: `receivedDateTime ge ${sinceIso}`,
    });
    const res = await fetch(`${GRAPH}/${folder}/messages?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) continue;
    const json = await res.json().catch(() => ({}));
    for (const m of json.value || []) {
      out.push({
        folder,
        at: m.receivedDateTime,
        from: m.from?.emailAddress?.address || '',
        subject: m.subject || '',
        body: m.body?.content || '',
      });
    }
  }
  return out;
}

export function activationLink(body) {
  for (const raw of String(body).replace(/&amp;/g, '&').match(/https?:\/\/[^\s"'<>]+/g) || []) {
    if (!ACTIVATION_RE.test(raw)) continue;
    try {
      const url = new URL(raw);
      if (url.hostname === 'dashboard.oxylabs.io' && url.pathname === '/activate-user' && url.searchParams.get('token')) return url.href;
    } catch { /* bỏ qua link hỏng */ }
  }
  return null;
}

export async function waitForActivation(mail, sinceDate, { timeoutMs = 300000, pollMs = 10000, log = console.log } = {}) {
  const sinceIso = new Date(sinceDate).toISOString();
  const token = await tokenFor(mail);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await messages(mail, token, sinceIso);
    for (const m of list) {
      if (!/oxylabs/i.test(m.from)) continue;
      const link = activationLink(m.body);
      if (link) {
        log(`mail: "${m.subject}" -> ${m.folder}`);
        return link;
      }
    }
    await sleep(pollMs);
  }
  throw new MailError('Không nhận được mail kích hoạt trong thời gian chờ', 'MAIL_TIMEOUT');
}

// Chờ một loại link khác (reset mật khẩu...): match(url) tự kiểm tra.
export async function waitForLink(mail, sinceDate, { match, timeoutMs = 180000, pollMs = 8000, log = console.log } = {}) {
  const sinceIso = new Date(sinceDate).toISOString();
  const token = await tokenFor(mail);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await messages(mail, token, sinceIso);
    for (const m of list) {
      if (!/oxylabs/i.test(m.from)) continue;
      for (const raw of String(m.body).replace(/&amp;/g, '&').match(/https?:\/\/[^\s"'<>]+/g) || []) {
        let url;
        try { url = new URL(raw); } catch { continue; }
        if (url.hostname !== 'dashboard.oxylabs.io') continue;
        if (match(url)) {
          log(`mail: "${m.subject}" -> ${url.pathname}`);
          return url.href;
        }
      }
    }
    await sleep(pollMs);
  }
  throw new MailError('Không nhận được mail reset trong thời gian chờ', 'MAIL_TIMEOUT');
}

export async function preflight(mail) {
  await tokenFor(mail);
  return true;
}
