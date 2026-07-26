import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ====================== CONFIG ======================

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOT_TOKEN = process.env.BOT_TOKEN;
const ALLOWED_USERS = (process.env.ALLOWED_USERS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(Number);

const SS_DIR = path.join(__dirname, 'screenshots');

// Buat folder screenshots
if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });

// ====================== HELPER ======================

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function isAuthorized(userId) {
    if (ALLOWED_USERS.length === 0) return true;
    return ALLOWED_USERS.includes(userId);
}

function validateEmail(email) {
    return EMAIL_REGEX.test(email);
}

function maskEmail(email) {
    const [local, domain] = email.split('@');
    const masked = local.length > 3
        ? local.slice(0, 3) + '***'
        : local[0] + '***';
    return `${masked}@${domain}`;
}

function timestamp() {
    const now = new Date();
    const y = now.getFullYear();
    const M = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return `${y}${M}${d}_${h}${m}${s}`;
}

// ====================== AUTOMATION ======================

/**
 * 1. Buka netflix.com/au/
 * 2. Isi email → Get Started
 * 3. Redirect ke /signup?serverState=...
 * 4. Klik "Send Link"
 * 5. Return URL final + screenshot
 */
async function netflixAuSignup(email) {
    const ts = timestamp();
    const ssPath = path.join(SS_DIR, `netflix_${ts}.png`);

    const result = {
        success: false,
        message: '',
        redirectUrl: '',
        screenshotPath: ssPath,
    };

    let browser;
    let page;

    try {
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-web-security',
                '--disable-blink-features=AutomationControlled',
                '--no-first-run',
                '--no-service-autorun',
                '--password-store=basic',
                '--use-gl=swiftshader',
            ],
        });

        const context = await browser.newContext({
            proxy: {
                server: 'proxy.geonode.io:9000',
                username: 'geonode_bEmY7bxX9V-type-residential',
                password: '8ace6132-7e2e-4799-b8ef-f665d2417186',
            },
            viewport: { width: 1366, height: 768 },
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                'AppleWebKit/537.36 (KHTML, like Gecko) ' +
                'Chrome/125.0.0.0 Safari/537.36',
            locale: 'en-AU',
            timezoneId: 'Australia/Sydney',
        });

        page = await context.newPage();

        // ─── STEP 1: BUKA NETFLIX AU ───────────────────────────
        console.log(`[${maskEmail(email)}] Buka netflix.com/au/ ...`);
        await page.goto('https://www.netflix.com/au/', {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
        });
        await page.waitForTimeout(3000);

        // ─── STEP 2: CARI & ISI EMAIL ─────────────────────────
        const emailSelectors = [
            'input[type="email"]',
            'input[name="email"]',
            '#email',
            'input[placeholder*="Email"]',
            'input[placeholder*="email"]',
            '[data-uia="email-field"] input',
            'input[id*="email"]',
        ];

        let emailInput = null;

        for (const sel of emailSelectors) {
            try {
                const el = page.locator(sel).first();
                if (await el.isVisible({ timeout: 3000 })) {
                    emailInput = el;
                    console.log(`[${maskEmail(email)}] Email input: ${sel}`);
                    break;
                }
            } catch { /* skip */ }
        }

        // Fallback iframe
        if (!emailInput) {
            console.log(`[${maskEmail(email)}] Cari di iframe...`);
            const iframes = page.locator('iframe');
            const count = await iframes.count();
            for (let i = 0; i < count; i++) {
                try {
                    const fl = page.frameLocator(`iframe:nth-child(${i + 1})`);
                    const el = fl.locator('input[type="email"]').first();
                    if (await el.isVisible({ timeout: 2000 })) {
                        emailInput = el;
                        console.log(`  Email di iframe[${i}]`);
                        break;
                    }
                } catch { /* skip */ }
            }
        }

        if (!emailInput) {
            await page.screenshot({ path: ssPath, fullPage: true });
            result.message = '❌ Gagal: Tidak dapat menemukan input email di halaman Netflix.';
            result.screenshotPath = ssPath;
            return result;
        }

        await emailInput.click();
        await page.waitForTimeout(500);
        await emailInput.fill(email);
        console.log(`[${maskEmail(email)}] Email diisi ✅`);
        await page.waitForTimeout(1000);

        // ─── STEP 3: KLIK "GET STARTED" ──────────────────────
        const gsSelectors = [
            'button[type="submit"]',
            'a[data-uia="start-email-submit"]',
            'button:has-text("Get Started")',
            'button:has-text("Mulai")',
            'button:has-text("Start")',
            'button',
        ];

        let gsBtn = null;

        for (const sel of gsSelectors) {
            try {
                const el = page.locator(sel).first();
                if (await el.isVisible({ timeout: 2000 })) {
                    const text = ((await el.textContent()) || '').trim().toLowerCase();
                    const type = (await el.getAttribute('type')) || '';
                    if (
                        text.includes('get started') ||
                        text.includes('mulai') ||
                        text.includes('start') ||
                        text.includes('getstarted') ||
                        text.includes('sign up') ||
                        type === 'submit'
                    ) {
                        gsBtn = el;
                        console.log(`[${maskEmail(email)}] Get Started: '${text.slice(0, 40)}'`);
                        break;
                    }
                }
            } catch { /* skip */ }
        }

        if (!gsBtn) {
            // JS fallback
            try {
                await page.evaluate(() => {
                    const input = document.querySelector('input[type="email"]');
                    if (input) {
                        const form = input.closest('form');
                        if (form) {
                            const btn = form.querySelector('button');
                            if (btn) btn.click();
                        }
                    }
                });
                console.log(`[${maskEmail(email)}] Get Started via JS`);
            } catch (e) {
                await page.screenshot({ path: ssPath, fullPage: true });
                result.message = '❌ Gagal: Tidak dapat menemukan tombol Get Started.';
                result.screenshotPath = ssPath;
                return result;
            }
        } else {
            await gsBtn.click();
            console.log(`[${maskEmail(email)}] Get Started diklik ✅`);
        }

        // ─── STEP 4: TUNGGU REDIRECT KE SIGNUP ───────────────
        await page.waitForTimeout(4000);
        try {
            await page.waitForURL('**/signup/**', { timeout: 25000 });
            console.log(`[${maskEmail(email)}] Redirect ke signup terdeteksi`);
        } catch {
            console.log(`[${maskEmail(email)}] Tidak redirect, URL skrg: ${page.url()}`);
        }
        await page.waitForTimeout(3000);

        // ─── STEP 5: KLIK "SEND LINK" ─────────────────────────
        const sendLinkSelectors = [
            'button:has-text("Send Link")',
            'button:has-text("Send link")',
            'button:has-text("send link")',
            'a:has-text("Send Link")',
            'a:has-text("Send link")',
            'button:has-text("Send a sign-up link")',
            'button:has-text("Send sign-up link")',
            '[data-uia*="send"]:has-text("link")',
            'button',
            'button[type="submit"]',
        ];

        let sendLinkBtn = null;

        for (const sel of sendLinkSelectors) {
            try {
                const el = page.locator(sel).first();
                if (await el.isVisible({ timeout: 2000 })) {
                    const text = ((await el.textContent()) || '').trim().toLowerCase();
                    if (text.includes('send') && text.includes('link')) {
                        sendLinkBtn = el;
                        console.log(`[${maskEmail(email)}] Send Link: '${text.slice(0, 50)}'`);
                        break;
                    }
                    if (text === 'send link' || text === 'send a link') {
                        sendLinkBtn = el;
                        break;
                    }
                }
            } catch { /* skip */ }
        }

        // Full page scan
        if (!sendLinkBtn) {
            console.log(`[${maskEmail(email)}] Cari Send Link via full page scan...`);
            const buttons = page.locator('button, a');
            const count = await buttons.count();
            for (let i = 0; i < count; i++) {
                try {
                    const btn = buttons.nth(i);
                    if (await btn.isVisible()) {
                        const text = ((await btn.textContent()) || '').trim().toLowerCase();
                        if (text.includes('send') && text.includes('link')) {
                            sendLinkBtn = btn;
                            console.log(`  Ditemukan: '${text.slice(0, 50)}'`);
                            break;
                        }
                    }
                } catch { /* skip */ }
            }
        }

        // Fallback form button
        if (!sendLinkBtn) {
            try {
                const formBtn = page.locator('form button, form a[role="button"]').first();
                if (await formBtn.isVisible({ timeout: 2000 })) {
                    const text = ((await formBtn.textContent()) || '').trim().toLowerCase();
                    if (text.includes('send') || text.includes('link') || text.includes('next') || text.includes('continue')) {
                        sendLinkBtn = formBtn;
                        console.log(`  Tombol form: '${text.slice(0, 50)}'`);
                    }
                }
            } catch { /* skip */ }
        }

        if (!sendLinkBtn) {
            const currentUrl = page.url();
            await page.screenshot({ path: ssPath, fullPage: true });
            result.message =
                '⚠️ Email sudah diisi & Get Started diklik, redirect ke halaman signup, ' +
                'TAPI tidak dapat menemukan tombol Send Link.';
            result.redirectUrl = currentUrl;
            result.screenshotPath = ssPath;
            return result;
        }

        // Klik Send Link
        await sendLinkBtn.click();
        console.log(`[${maskEmail(email)}] Send Link diklik ✅`);
        await page.waitForTimeout(4000);

        // ─── STEP 6: TANGKAP HASIL ────────────────────────────
        await page.screenshot({ path: ssPath, fullPage: true });
        const currentUrl = page.url();

        // Deteksi status
        const pageContent = await page.content();
        const sentKeywords = [
            'we sent', "we've sent", 'link sent', 'check your email',
            'email sent', 'verification sent', 'sign up link',
            "we'll send", 'link has been sent',
            'kami kirim', 'cek email',
        ];
        const linkSent = sentKeywords.some(kw => pageContent.toLowerCase().includes(kw));
        const onSignup = currentUrl.includes('/signup');

        if (linkSent) {
            result.success = true;
            result.message =
                `✅ *Berhasil!*\n\n` +
                `📧 \`${maskEmail(email)}\`\n\n` +
                `✔️ Email diisi di Netflix AU\n` +
                `✔️ Get Started diklik\n` +
                `✔️ Send Link diklik\n\n` +
                `🔗 Netflix telah mengirim *link signup* ke email tersebut.`;
            result.redirectUrl = currentUrl;
        } else if (onSignup) {
            result.success = true;
            result.message =
                `✅ *Selesai (redirect terdeteksi)*\n\n` +
                `📧 \`${maskEmail(email)}\`\n\n` +
                `Masih di halaman signup, link kemungkinan sudah dikirim ke email.`;
            result.redirectUrl = currentUrl;
        } else {
            result.success = true;
            result.message =
                `✅ *Selesai*\n\n` +
                `📧 \`${maskEmail(email)}\`\n` +
                `URL akhir: \`${currentUrl}\``;
            result.redirectUrl = currentUrl;
        }

        result.screenshotPath = ssPath;
        return result;

    } catch (err) {
        console.error(`Error: ${err.message}`, err);

        try {
            if (page && !page.isClosed()) {
                await page.screenshot({ path: ssPath, fullPage: true });
            }
        } catch { /* skip */ }

        result.message = `❌ *Error:* \`${err.message}\``;
        result.screenshotPath = ssPath;
        return result;

    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch { /* skip */ }
        }
    }
}

// ====================== TELEGRAM BOT ======================

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ─── /start ───
bot.onText(/^\/start$/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId,
        `🤖 *Netflix AU Gen Bot*\n\n` +
        `📌 *Perintah:*\n` +
        `• \`/gen email@domain.com\` — Isi form & klik Send Link\n` +
        `• \`/help\` — Bantuan\n\n` +
        `*Alur:*\n` +
        `1️⃣ Buka \`netflix.com/au/\`\n` +
        `2️⃣ Isi email\n` +
        `3️⃣ Klik Get Started\n` +
        `4️⃣ Klik Send Link\n` +
        `5️⃣ Kirim URL + screenshot ke kamu\n\n` +
        `Contoh: \`/gen user@example.com\``,
        { parse_mode: 'Markdown' }
    );
});

// ─── /help ───
bot.onText(/^\/help$/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId,
        `📖 *Bantuan*\n\n` +
        `\`/gen email@domain.com\`\n` +
        `  → Otomatisasi signup Netflix AU\n\n` +
        `\`/start\` — Mulai bot\n` +
        `\`/help\` — Bantuan ini`,
        { parse_mode: 'Markdown' }
    );
});

// ─── /gen email@domain.com ───
bot.onText(/^\/gen\s+(\S+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const email = (match[1] || '').trim().toLowerCase();

    // Otorisasi
    if (!isAuthorized(userId)) {
        await bot.sendMessage(chatId, '⛔ Kamu tidak terdaftar sebagai pengguna yang diizinkan.');
        return;
    }

    // Validasi email
    if (!validateEmail(email)) {
        await bot.sendMessage(chatId,
            '❌ Format email tidak valid.\nGunakan: `user@domain.com`',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    // Kirim status processing
    const statusMsg = await bot.sendMessage(chatId,
        `⏳ *Memproses...*\n\n` +
        `📧 Email: \`${maskEmail(email)}\`\n` +
        `🌐 Region: 🇦🇺 Netflix Australia\n\n` +
        `1️⃣ Buka netflix.com/au/\n` +
        `2️⃣ Isi email & klik Get Started\n` +
        `3️⃣ Klik Send Link di halaman signup`,
        { parse_mode: 'Markdown' }
    );

    // Jalankan automation
    const result = await netflixAuSignup(email);

    // Response
    let response = result.message + '\n\n';
    response += `📧 *Email:* \`${maskEmail(email)}\`\n`;
    response += `🌐 *Region:* 🇦🇺 Netflix Australia\n`;

    if (result.redirectUrl) {
        response += `\n🔗 *URL Hasil:*\n\`${result.redirectUrl}\`\n\n`;
        response += `💡 Buka email \`${maskEmail(email)}\` dan cari email dari Netflix untuk melanjutkan pendaftaran.`;
    }

    // Edit pesan processing
    try {
        await bot.editMessageText(response, {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown',
        });
    } catch (err) {
        console.warn(`Gagal edit pesan: ${err.message}`);
    }

    // Kirim screenshot
    if (result.screenshotPath && fs.existsSync(result.screenshotPath)) {
        try {
            await bot.sendPhoto(chatId, result.screenshotPath, {
                caption: `📸 Screenshot — ${maskEmail(email)}`,
            });
        } catch (err) {
            console.warn(`Gagal kirim screenshot: ${err.message}`);
        }

        // Hapus screenshot
        try { fs.unlinkSync(result.screenshotPath); } catch { /* skip */ }
    }
});

// Fallback untuk /gen tanpa argumen
bot.onText(/^\/gen$/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId,
        '⚠️ *Cara pakai:*\n' +
        '`/gen email@domain.com`\n\n' +
        'Contoh: `/gen user@example.com`',
        { parse_mode: 'Markdown' }
    );
});

// ====================== ERROR HANDLER ======================

bot.on('polling_error', (err) => {
    console.error(`Polling error: ${err.message}`);
});

bot.on('error', (err) => {
    console.error(`Bot error: ${err.message}`);
});

// ====================== STARTUP ======================

console.log('🤖 Netflix AU Gen Bot started!');
console.log(`📁 Screenshots dir: ${SS_DIR}`);
console.log(`👥 Allowed users: ${ALLOWED_USERS.length === 0 ? 'PUBLIC' : ALLOWED_USERS.join(', ')}`);
