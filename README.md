# oxylabs-register

Đăng ký tài khoản Oxylabs mới → kích hoạt email → đăng nhập dashboard → tạo **Residential Proxy** instance → xuất curl/credentials. 

## Yêu cầu

- Node.js >= 22.13, AdsPower đang chạy (`local.adspower.net:50325`).
- Checkout roadtopre ở `D:/Dev/roadtopre` (đổi bằng `OXY_ROADTO`), có:
  - `shoptool/app/data/mail_pool.json` — mail hotmail/outlook kèm refreshToken;
  - `shoptool/register/node_modules/playwright` — module mượn Playwright + browser đã cài.
- Không cần CapSolver: luồng hiện tại không gặp Turnstile ở bước đăng ký (Cloudflare chỉ chặn khi mở thẳng URL, xem bên dưới).

## Chạy

```bash
node run.mjs --count 1
node run.mjs --count 5                  # batch tuần tự
node run.mjs --mail abc@hotmail.com     # ép một mailbox cụ thể
node run.mjs --profile k1iqri3o         # dùng lại profile AdsPower có sẵn
node run.mjs --count 1 --proxy "http://user:pass@pr.oxylabs.io:7777"
```

Không truyền `--proxy` thì chạy IP trực tiếp của máy. Proxy pool hiện tại của roadtopre (`proxy_template.json`) đã hết hạn (407), nên mặc định để trống.

## Kết quả

- `data/accounts/<email>.json` — checkpoint từng account (email, password, profile, instance, curl).
- `data/instances.csv` — bảng tổng: `created_at,email,instance_name,instance_id,endpoint,username,password,curl`.
- `data/shots/` — screenshot lúc lỗi để gỡ.
- Mail dùng xong được đánh dấu `used` + `shop: oxylabs` trong `mail_pool.json`.

Chạy lại cùng lệnh: account đã có `curl` thì bỏ qua; account đang dở thì đi tiếp từ bước đã lưu (`signup` → `signup_done` → `activated` → `done`).

## Luồng

1. **Signup** — mở `/en/`, bấm **Register instead** (route client-side), điền Name / Surname / Email / Password, bấm **Register**. Mật khẩu sinh ngẫu nhiên đúng luật Oxylabs (≥7 ký tự, hoa + thường + số + ký tự đặc biệt).
2. **Activate** — đọc mail `notifications@oxylabs.io`, lấy link `dashboard.oxylabs.io/activate-user?token=...`, mở trong chính profile.
3. **Login** — dashboard `/en/`, đăng nhập email + password.
4. **Instance** — `/en/instances/new?type=RP`, đặt tên ngẫu nhiên `rp-xxxxxx`, auth `Username & password`, bấm **Create instance**, đọc dòng `curl` trên trang instance.

## Ghi chú kỹ thuật

- **Cloudflare**: `GET /en/registration` trả 403 "Just a moment"; `/en/` thì mở được. Vì vậy luồng luôn vào bằng trang login rồi bấm link sang registration (client-side navigation, không phát sinh request bị chặn).
- **Chat widget Salesforce** phủ góc dưới phải và nuốt click (đã gặp ở nút Register) → `hideChat()` bơm CSS ẩn `#sf-chat-widget-root` trước mỗi lần bấm.
- **Nút submit điều hướng trang**: Playwright treo 20s ở "performing click action" dù request đã bắn → `Register` và `Create instance` bấm bằng DOM (`element.click()` trong `page.evaluate`), không dùng actionability.
- **Session**: sau activate, dashboard có thể chưa set session; `loginIfNeeded` chờ form login hoặc nav dashboard rồi mới kết luận, tránh tưởng nhầm "đã đăng nhập".
- **KYC**: instance Enabled nhưng proxy trả 407 khi dashboard hiện banner "Verify your account within 72 hours" — xác minh tài khoản rồi thử lại.
- **Credit**: mỗi account mới có $5 welcome credit; Residential Proxies $6/GB → khoảng 830 MB. Instance tạo xong là dùng được ngay.
- **Vị trí IP**: mặc định `Any` (random toàn cầu). Muốn ép US, sửa username trong curl thành `customer-resi_<id>-cc-US-sessid-<token>-sesstime-<n>`.
- **Session**: token `sessid` trong curl đổi được để lấy IP mới; `sesstime` là số phút giữ session.
- **Needs human**: captcha/Cloudflare lạ hoặc trang đổi UI sẽ dừng với `needs_human` và để lại screenshot trong `data/shots/`.
