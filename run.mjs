#!/usr/bin/env node
// Đăng ký tài khoản Oxylabs mới → kích hoạt mail → tạo Residential Proxy instance → xuất curl.
//
//   node run.mjs --count 1
//   node run.mjs --count 5 --proxy "http://user:pass@pr.oxylabs.io:7777"
//   node run.mjs --mail abc@hotmail.com --profile k1iqri3o
//
// Mỗi account: một profile AdsPower riêng, một mailbox từ pool roadtopre.
// Checkpoint ở data/accounts/<email>.json — chạy lại thì bỏ qua account đã có curl.
import fs from 'node:fs';
import path from 'node:path';
import { ACCOUNTS, DATA, sleep } from './src/config.mjs';
import { createProfile, openProfile, stopProfile } from './src/ads.mjs';
import { markMail, pickMail, preflight, waitForActivation } from './src/mail.mjs';
import { createResidential, loginIfNeeded, openRegistration, submitSignup, activate, StepError } from './src/oxylabs.mjs';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node run.mjs [--count N] [--mail email] [--profile adsUserId] [--proxy http://user:pass@host:port]');
  process.exit(0);
}
const KNOWN = new Set(['--count', '--mail', '--profile', '--proxy']);
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  const name = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
  if (!KNOWN.has(name)) { console.error(`Cờ lạ: ${a}. Dùng --help.`); process.exit(2); }
  if (!a.includes('=')) i += 1; // bỏ giá trị đi kèm
}
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) return args[i + 1];
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
};
const COUNT = Math.max(1, Number(flag('count', '1')) || 1);
const PROXY = flag('proxy', '') || '';
const ONLY_MAIL = flag('mail', '') || '';
const ONLY_PROFILE = flag('profile', '') || '';

const FIRST = ['James', 'Michael', 'Daniel', 'Robert', 'Thomas', 'William', 'Ethan', 'Jacob', 'Lucas', 'Henry', 'Samuel', 'Peter'];
const LAST = ['Miller', 'Smith', 'Brown', 'Wilson', 'Taylor', 'Anderson', 'Thomas', 'Moore', 'Jackson', 'White', 'Harris', 'Clark'];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const randomInstanceName = () => `rp-${Math.random().toString(36).slice(2, 8)}`;

function makePassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%^&*?_+-';
  const one = (s) => s[Math.floor(Math.random() * s.length)];
  return one(upper) + one(lower) + one(digits) + one(special) +
    Array.from({ length: 8 }, () => one(upper + lower + digits + special)).join('');
}

const accountFile = (email) => path.join(ACCOUNTS, `${email.toLowerCase().replace(/[^a-z0-9._-]/g, '_')}.json`);

function readAccount(email) {
  const file = accountFile(email);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function writeAccount(account) {
  fs.mkdirSync(ACCOUNTS, { recursive: true });
  fs.writeFileSync(accountFile(account.email), JSON.stringify(account, null, 2));
  const csv = path.join(DATA, 'instances.csv');
  if (!fs.existsSync(csv)) fs.writeFileSync(csv, 'created_at,email,instance_name,instance_id,endpoint,username,password,curl\n');
  if (account.status === 'done') {
    const row = [account.createdAt, account.email, account.instanceName, account.instanceId, account.endpoint,
      account.username, account.password, account.curl].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
    if (!fs.readFileSync(csv, 'utf8').includes(account.email)) fs.appendFileSync(csv, `${row}\n`);
  }
}

async function registerOne(index) {
  const mail = pickMail(ONLY_MAIL || undefined);
  if (mail.status !== 'available') throw new StepError('mail_used', `Mail ${mail.email} đang ở trạng thái ${mail.status}`);
  const existing = readAccount(mail.email);
  if (existing?.status === 'done' && existing.curl) {
    console.log(`[${index}] bỏ qua ${mail.email} — đã có instance ${existing.instanceName}`);
    return existing;
  }
  await preflight(mail);

  const account = existing || {
    email: mail.email,
    password: makePassword(),
    firstName: pick(FIRST),
    lastName: pick(LAST),
    createdAt: new Date().toISOString(),
    adsUser: ONLY_PROFILE || '',
    status: 'signup',
  };
  if (!account.adsUser) {
    account.adsUser = await createProfile(`oxy-${account.email.split('@')[0]}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 48), PROXY);
    writeAccount(account);
  }
  console.log(`[${index}] ${account.email} | profile ${account.adsUser}`);

  const { browser, page } = await openProfile(account.adsUser);
  try {
    if (account.status === 'signup') {
      await openRegistration(page);
      await submitSignup(page, account);
      account.status = 'signup_done';
      account.signupAt = new Date().toISOString();
      writeAccount(account);
      console.log(`[${index}] đăng ký xong, chờ mail kích hoạt`);
    }

    if (account.status === 'signup_done') {
      const link = await waitForActivation(mail, account.signupAt || account.createdAt, { log: (m) => console.log(`[${index}] ${m}`) });
      await activate(page, link, (m) => console.log(`[${index}] ${m}`));
      account.status = 'activated';
      writeAccount(account);
    }

    await loginIfNeeded(page, account, (m) => console.log(`[${index}] ${m}`));

    const instance = await createResidential(page, randomInstanceName(), (m) => console.log(`[${index}] ${m}`));
    const { instanceId, instanceName, endpoint, proxyUsername, proxyPassword, curl } = instance;
    Object.assign(account, { instanceId, instanceName, endpoint, username: proxyUsername, proxyPassword, curl, target: instance.target, dashboardUrl: instance.dashboardUrl, status: 'done', finishedAt: new Date().toISOString() });
    delete account.error;
    writeAccount(account);
    markMail(account.email, { status: 'used', shop: 'oxylabs', reason: `Oxylabs ${instance.instanceName}` });
    console.log(`[${index}] XONG ${account.email}`);
    console.log(instance.curl);
    return account;
  } catch (error) {
    account.error = { kind: error.kind || 'error', message: error.message, at: new Date().toISOString() };
    writeAccount(account);
    console.error(`[${index}] LỖI ${account.email}: ${error.kind || ''} ${error.message}`);
    return account;
  } finally {
    await browser.close().catch(() => {});
    await stopProfile(account.adsUser);
    await sleep(1000);
  }
}

async function main() {
  fs.mkdirSync(ACCOUNTS, { recursive: true });
  console.log(`Oxylabs register — ${COUNT} account${COUNT > 1 ? 's' : ''}${PROXY ? ` | proxy ${PROXY.replace(/\/\/[^@]+@/, '//***@')}` : ' | direct'}`);
  const done = [];
  for (let i = 1; i <= COUNT; i += 1) {
    try {
      done.push(await registerOne(i));
    } catch (error) {
      console.error(`[${i}] DỪNG: ${error.kind || ''} ${error.message}`);
      if (error.kind === 'mail_empty') break;
    }
  }
  const ok = done.filter((a) => a?.status === 'done');
  console.log(`\nTổng: ${ok.length}/${COUNT} account có proxy.`);
  for (const a of ok) console.log(`${a.email} | ${a.instanceName} | ${a.curl}`);
}

main().catch((error) => { console.error('FATAL', error); process.exitCode = 1; });
