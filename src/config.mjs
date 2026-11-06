// Cấu hình đường dẫn. Module đứng riêng, dùng lại hạ tầng của roadtopre:
// pool mail (mail_pool.json), proxy template, AdsPower và Playwright đã cài sẵn.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const ROADTO = process.env.OXY_ROADTO || 'D:/Dev/roadtopre';

export const MAIL_POOL = process.env.OXY_MAIL_POOL || path.join(ROADTO, 'shoptool', 'app', 'data', 'mail_pool.json');
export const PROXY_TEMPLATE = process.env.OXY_PROXY_TEMPLATE || path.join(ROADTO, 'shoptool', 'app', 'data', 'proxy_template.json');
export const DATA = path.join(ROOT, 'data');
export const ACCOUNTS = path.join(DATA, 'accounts');
export const SHOTS = path.join(DATA, 'shots');

export const ADS_API = process.env.ADSPOWER_API || 'http://local.adspower.net:50325';

// Playwright lấy từ checkout roadtopre (đã có browser + version khớp cache).
const require = createRequire(path.join(ROADTO, 'shoptool', 'register', 'package.json'));
export const { chromium } = require('playwright');

export const OXY = {
  origin: 'https://dashboard.oxylabs.io',
  loginPath: '/en/',
  registrationPath: '/en/registration',
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
