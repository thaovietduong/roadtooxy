// Các bước trên dashboard.oxylabs.io: đăng ký → kích hoạt mail → đăng nhập → tạo Residential instance → đọc curl.
import fs from 'node:fs';
import path from 'node:path';
import { OXY, SHOTS, sleep } from './config.mjs';

export class StepError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

const SHOT = (page, tag) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  return page.screenshot({ path: path.join(SHOTS, `${tag}.png`), fullPage: true }).catch(() => {});
};

const text = (page) => page.evaluate(() => document.body?.innerText ?? '').catch(() => '');

// Chat widget của Salesforce phủ góc dưới phải và nuốt cú click (đã gặp ở nút Register).
async function hideChat(page) {
  await page.addStyleTag({ content: '#sf-chat-widget-root,.embeddedMessagingConversationButtonWrapper,#sf-chat-chat-widget,[id^="sf-chat"]{display:none!important;visibility:hidden!important}' }).catch(() => {});
}

// Cloudflare "Just a moment" có thể chặn 5-10 giây đầu; chờ app thật sự lên.
async function waitForApp(page, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.locator('input[name="username"], input[name="email"]').count().catch(() => 0)) return true;
    const body = await text(page);
    if (/log in to your account|verify your email|register|create instance/i.test(body)) return true;
    if (/just a moment|chờ một chút/i.test(body)) { await sleep(2000); continue; }
    await sleep(1000);
  }
  return false;
}

// Cloudflare chặn truy cập thẳng /en/registration (403 Just a moment). Trang login thì mở được,
// đường dẫn registration là route client-side nên phải bấm link "Register instead" từ login.
// Đôi khi cú click bị Cloudflare reload nuốt mất -> thử lại bằng route client-side rồi mới goto thẳng.
export async function openRegistration(page) {
  await page.goto(`${OXY.origin}${OXY.loginPath}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  if (!(await waitForApp(page))) throw new StepError('registration_page', 'Trang login không tải được (Cloudflare?)');
  const register = page.getByRole('link', { name: /register instead/i }).first();
  if ((await register.count().catch(() => 0)) === 0) {
    throw new StepError('registration_page', 'Không thấy link "Register instead"');
  }
  for (let attempt = 0; attempt < 2 && !/\/registration/.test(page.url()); attempt += 1) {
    await register.click({ timeout: 8000, force: attempt > 0 }).catch(() => {});
    await sleep(2000);
  }
  if (!/\/registration/.test(page.url())) {
    await page.evaluate(() => {
      window.history.pushState({}, '', '/en/registration');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }).catch(() => {});
    await sleep(2500);
  }
  if (!/\/registration/.test(page.url())) {
    await page.goto(`${OXY.origin}${OXY.registrationPath}`, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
    await waitForApp(page);
  }
  await page.locator('input[name="email"]').first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  if (!(await page.locator('input[name="email"]').count())) {
    await SHOT(page, 'registration-page');
    throw new StepError('registration_page', `Trang đăng ký không hiện form (url ${page.url()})`);
  }
}

// Trả về { ok: true } hoặc ném lỗi; email đã tồn tại = kind 'email_taken'.
export async function submitSignup(page, account) {
  await page.fill('input[name="name"]', account.firstName);
  await page.fill('input[name="surname"]', account.lastName);
  await page.fill('input[name="email"]', account.email);
  await page.fill('input[name="password"]', account.password);
  await sleep(800);
  await hideChat(page);
  // DOM click: nút submit làm trang điều hướng, Playwright actionability treo 20s dù form đã gửi.
  await page.evaluate(() => document.querySelector('[data-test="button-registration-continue"]')?.click()).catch(() => {});
  await sleep(10000);
  const body = await text(page);
  if (/verify your email/i.test(body)) return { ok: true };
  const alert = await page.locator('[role="alert"], .error, [class*="error" i], [class*="invalid" i]').first().innerText().catch(() => '');
  const reason = (alert || '').trim().split('\n')[0] || 'không xác định';
  await SHOT(page, 'signup-error');
  if (/already|exists|in use|registered|taken/i.test(alert || body)) throw new StepError('email_taken', reason);
  throw new StepError('signup_failed', reason);
}

export async function activate(page, link, log = console.log) {
  await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await sleep(9000);
  // Trang có thể trắng (SPA route); API activate đã trả 200/400 là đủ.
  log('activation mở xong:', page.url());
  return true;
}

async function onLoginPage(page) {
  return (await page.locator('input[name="username"]').count().catch(() => 0)) > 0 &&
    (await page.locator('input[name="username"]').first().isVisible().catch(() => false));
}

async function dashboardReady(page) {
  const body = await text(page);
  return /billing & spending|refer & earn|create instance/i.test(body);
}

export async function loginIfNeeded(page, account, log = console.log) {
  await page.goto(`${OXY.origin}${OXY.loginPath}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  if (!(await waitForApp(page))) throw new StepError('login_page', 'Trang login không tải được (Cloudflare?)');
  // Chờ app render xong: hoặc form login, hoặc dashboard (session còn sống).
  for (let i = 0; i < 15; i += 1) {
    if (await onLoginPage(page)) break;
    if (await dashboardReady(page)) return false;
    await sleep(1000);
  }
  if (!(await onLoginPage(page))) return false; // đã đăng nhập
  await hideChat(page);
  await page.fill('input[name="username"]', account.email);
  await page.fill('input[name="password"]', account.password);
  await page.getByRole('button', { name: /log in/i }).first().click({ timeout: 20000 }).catch(() => {});
  await sleep(9000);
  for (let i = 0; i < 15 && (await onLoginPage(page)); i += 1) await sleep(1000);
  if (await onLoginPage(page)) {
    const body = await text(page);
    await SHOT(page, 'login-failed');
    if (/incorrect|invalid|wrong|không đúng/i.test(body)) throw new StepError('login_failed', 'Sai email/mật khẩu');
    throw new StepError('login_failed', 'Không qua được trang đăng nhập');
  }
  log('login ok:', page.url());
  return true;
}

// Tạo instance Residential Proxy và đọc lại dòng curl.
export async function createResidential(page, name, log = console.log) {
  await page.goto(`${OXY.origin}/en/instances/new?type=RP`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(6000);
  if (/redirect=/.test(page.url())) throw new StepError('login_failed', 'Session hết hạn trước khi tạo instance');
  await hideChat(page);
  const close = page.getByRole('button', { name: /^close$/i }).first();
  if (await close.count().catch(() => 0)) await close.click({ timeout: 4000 }).catch(() => {});
  await sleep(800);

  const field = page.locator('input[name="name"]').first();
  await field.waitFor({ state: 'visible', timeout: 25000 });
  await field.fill(name);
  // Auth mặc định là username & password; chọn lại cho chắc.
  const cred = page.locator('input#credentials, input[name="authType"][value="credentials"]').first();
  if (await cred.count().catch(() => 0)) await cred.check({ timeout: 4000 }).catch(() => {});
  await sleep(600);
  // DOM click: submit điều hướng trang, Playwright actionability treo dù request đã bắn.
  await page.evaluate(() => document.querySelector('[data-testid="asset-form-create-project-button"]')?.click()).catch(() => {});
  await page.waitForURL(/\/instances\/[0-9a-f-]+\/overview/, { timeout: 90000 }).catch(() => {});
  await sleep(5000);

  const url = page.url();
  const instanceId = (url.match(/\/instances\/([0-9a-f-]+)\//) || [])[1] || null;
  const body = await text(page);
  const curl = (body.match(/curl -x (\S+) -U "([^"]+)" (\S+)/) || null);
  await SHOT(page, `instance-${name}`);
  if (!instanceId || !curl) {
    throw new StepError('needs_human', `Không đọc được curl sau khi tạo instance (url ${url})`);
  }
  const endpoint = curl[1];
  const credentials = curl[2];
  const target = curl[3];
  const sep = credentials.indexOf(':');
  return {
    instanceId,
    instanceName: name,
    endpoint,
    proxyUsername: credentials.slice(0, sep),
    proxyPassword: credentials.slice(sep + 1),
    target,
    curl: `curl -x ${endpoint} -U "${credentials}" ${target}`,
    dashboardUrl: url,
  };
}
