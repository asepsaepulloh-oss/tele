import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOT_TOKEN = process.env.BOT_TOKEN;
const ALLOWED_USERS = (process.env.ALLOWED_USERS || '')
    .split(',').map(s => s.trim()).filter(Boolean).map(Number);

const SS_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });

// ====================== HELPER ======================

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function isAuthorized(uid) {
    return ALLOWED_USERS.length === 0 || ALLOWED_USERS.includes(uid);
}

function validateEmail(email) {
    return EMAIL_REGEX.test(email);
}

function maskEmail(email) {
    const [local, domain] = email.split('@');
    const masked = local.length > 3 ? local.slice(0, 3) + '***' : local[0] + '***';
    return `${masked}@${domain}`;
}

function timestamp() {
    const n = new Date();
    return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}_${String(n.getHours()).padStart(2,'0')}${String(n.getMinutes()).padStart(2,'0')}${String(n.getSeconds()).padStart(2,'0')}`;
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ====================== AUTOMATION ======================

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
    let context;

    try {
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', '--disable-gpu',
                '--disable-blink-features=AutomationControlled',
                '--no-first-run',
                '--no-service-autorun',
                '--password-store=basic',
                '--use-gl=swiftshader',
            ],
        });

        context = await browser.newContext({
            // Konfigurasi Proxy 711proxy (Region Australia)
            proxy: {
                server: 'http://global.rotgb.711proxy.com:10000',
                username: 'USER213247-zone-custom-region-AU',
                password: '61e56c',
            },
            viewport: { width: 1366, height: 768 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
            locale: 'en-AU',
            timezoneId: 'Australia/Sydney',
        });

        // 🧹 Otomatis Hapus Cookie di awal sesi
        await context.clearCookies();
        console.log('🧹 Cookie berhasil dibersihkan.');

        page = await context.newPage();

        // ─── STEP 1: BUKA netflix.com/au/ ────────────────────
        console.log(`[${maskEmail(email)}] Buka netflix.com/au/ ...`);
        await page.goto('https://www.netflix.com/au/', {
            waitUntil: 'networkidle',
            timeout: 60000,
        });
        await sleep(3000);

        // ─── STEP 2: ISI EMAIL (Gaya Ketik Manusia) ───────────
        const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="Email"]').first();
        await emailInput.waitFor({ state: 'visible', timeout: 15000 });
        await emailInput.click();
        await sleep(500);
        
        // Ketik perlahan per karakter agar tidak terdeteksi bot instan
        await emailInput.pressSequentially(email, { delay: 100 });
        console.log(`  Email diisi: ${email} ✅`);
        await sleep(1000);

        // ─── STEP 3: KLIK "Continue" / "Get Started" ──────────
        const getStartedBtn = page.getByRole('button', {
            name: /continue|get started|mulai|start/i
        }).first();

        await getStartedBtn.waitFor({ state: 'visible', timeout: 10000 });
        await sleep(800); // Jeda sebelum klik
        await getStartedBtn.click();
        console.log('  Tombol Continue/Get Started diklik ✅');
        await sleep(4000);

        // ─── STEP 4: TUNGGU HALAMAN "We'll send a sign-up link" ──
        try {
            await page.waitForFunction(
                () => window.location.href.includes('/signup') ||
                       window.location.href.includes('signup'),
                { timeout: 20000 }
            );
            console.log('  Redirect ke halaman signup terdeteksi ✅');
        } catch {
            console.log('  Redirect tidak terdeteksi dalam 20s, lanjut...');
        }

        await sleep(2000);

        const currentUrl = page.url();
        console.log(`  URL skrg: ${currentUrl}`);

        // ─── STEP 5: CEK APAKAH HALAMAN "Send Link" ──────────
        const bodyText = await page.locator('body').innerText();
        const isSendLinkPage = bodyText.includes("We'll send a sign-up link") ||
                               bodyText.includes("send a sign-up link") ||
                               bodyText.includes("Send Link");

        if (!isSendLinkPage) {
            await page.screenshot({ path: ssPath, fullPage: true });
            result.message =
                `⚠️ Halaman yang muncul BUKAN "We'll send a sign-up link".\n` +
                `Mungkin terdeteksi atau masuk flow standar.\n` +
                `URL: \`${currentUrl}\``;
            result.redirectUrl = currentUrl;
            result.screenshotPath = ssPath;
            return result;
        }

        console.log('  Halaman "We\'ll send a sign-up link" terdeteksi ✅');

        // ─── STEP 6: KLIK TOMBOL "Send Link" ────────────────────
        const sendLinkBtn = page.getByRole('button', {
            name: /send link/i
        }).first();

        await sendLinkBtn.waitFor({ state: 'visible', timeout: 10000 });
        await sleep(800);
        await sendLinkBtn.click();
        console.log('  Tombol Send Link diklik ✅');

        // ─── STEP 7: TUNGGU & KONFIRMASI ──────────────────────
        await sleep(4000);

        await page.screenshot({ path: ssPath, fullPage: true });

        const finalUrl = page.url();
        const finalBody = await page.locator('body').innerText();

        const linkSent = finalBody.includes('link sent') ||
                         finalBody.includes('Link sent') ||
                         finalBody.includes('check your email') ||
                         finalBody.includes('Check your email') ||
                         finalBody.includes('we sent') ||
                         finalBody.includes('We sent');

        if (linkSent) {
            result.success = true;
            result.message =
                `✅ *Berhasil — Link Terkirim!*\n\n` +
                `📧 \`${maskEmail(email)}\`\n\n` +
                `✔️ **Step 1:** Email diisi di Netflix AU ✅\n` +
                `✔️ **Step 2:** Tombol **Continue** diklik ✅\n` +
                `✔️ **Step 3:** Tombol **Send Link** berhasil diklik ✅\n\n` +
                `🔗 *Netflix telah mengirim link signup ke:*\n` +
                `\`${email}\`\n\n` +
                `📌 *Langkah selanjutnya:*\n` +
                `1️⃣ Buka inbox **${maskEmail(email)}**\n` +
                `2️⃣ Cari email dari Netflix — subjek *"Finish setting up your account"*\n` +
                `3️⃣ Klik tombol **"Create Account"** di dalam email\n` +
                `4️⃣ Sampai di halaman **"Finish setting up your account"**\n` +
                `5️⃣ Buat password & pilih plan ✅\n\n` +
                `⚠️ Cek folder *Spam/Promotions* jika tidak ada di inbox.`;
            result.redirectUrl = finalUrl;
        } else {
            result.success = true;
            result.message =
                `✅ *Selesai*\n\n` +
                `📧 \`${maskEmail(email)}\`\n\n` +
                `✔️ Email diisi ✅\n` +
                `✔️ Continue diklik ✅\n` +
                `✔️ Send Link diklik ✅\n\n` +
                `🔗 URL akhir: \`${finalUrl}\`\n\n` +
                `Cek email \`${maskEmail(email)}\` untuk link dari Netflix.`;
            result.redirectUrl = finalUrl;
        }

        return result;

    } catch (err) {
        console.error(`Error: ${err.message}`, err);
        try { if (page && !page.isClosed()) await page.screenshot({ path: ssPath, fullPage: true }); } catch { /* skip */ }
        result.message = `❌ *Error:* \`${err.message}\``;
        result.screenshotPath = ssPath;
        return result;
    } finally {
        if (context) {
            try { await context.clearCookies(); } catch { /* skip */ }
        }
        if (browser) {
            try { await browser.close(); } catch { /* skip */ }
        }
    }
}

// ====================== TELEGRAM BOT ======================

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/^\/start$/, async (msg) => {
    await bot.sendMessage(msg.chat.id,
        `🤖 *Netflix AU Gen Bot*\n\n` +
        `📌 *Perintah:*\n` +
        `• \`/gen email@domain.com\` — Signup Netflix AU\n` +
        `• \`/help\` — Bantuan\n\n` +
        `*Alur:*\n` +
        `1️⃣ Buka \`netflix.com/au/\`\n` +
        `2️⃣ Isi email\n` +
        `3️⃣ Klik **Continue**\n` +
        `4️⃣ Klik **Send Link**\n` +
        `5️⃣ Link dikirim ke email ✅`,
        { parse_mode: 'Markdown' }
    );
});

bot.onText(/^\/help$/, async (msg) => {
    await bot.sendMessage(msg.chat.id,
        `📖 *Bantuan*\n\n` +
        `\`/gen email@domain.com\` — Signup Netflix AU\n` +
        `  → Isi email → Continue → Send Link\n\n` +
        `\`/start\` — Mulai bot\n` +
        `\`/help\` — Bantuan ini`,
        { parse_mode: 'Markdown' }
    );
});

bot.onText(/^\/gen\s+(\S+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const email = (match[1] || '').trim().toLowerCase();

    if (!isAuthorized(userId)) {
        await bot.sendMessage(chatId, '⛔ Kamu tidak terdaftar.');
        return;
    }

    if (!validateEmail(email)) {
        await bot.sendMessage(chatId,
            '❌ Format email tidak valid.\nGunakan: `user@domain.com`',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    const statusMsg = await bot.sendMessage(chatId,
        `⏳ *Memproses...*\n\n` +
        `📧 Email: \`${maskEmail(email)}\`\n` +
        `🌐 Region: 🇦🇺 Netflix Australia (Residential Proxy)\n\n` +
        `1️⃣ Buka netflix.com/au/\n` +
        `2️⃣ Isi email & klik Continue\n` +
        `3️⃣ Klik **Send Link**\n` +
        `4️⃣ Kirim hasil...`,
        { parse_mode: 'Markdown' }
    );

    const result = await netflixAuSignup(email);

    let response = result.message + '\n\n';
    response += `📧 *Email:* \`${maskEmail(email)}\`\n`;
    response += `🌐 *Region:* 🇦🇺 Netflix Australia\n`;

    if (result.redirectUrl) {
        response += `\n🔗 *URL:* \`${result.redirectUrl}\``;
    }

    try {
        await bot.editMessageText(response, {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
        });
    } catch (err) {
        console.warn(`Gagal edit pesan: ${err.message}`);
    }

    if (result.screenshotPath && fs.existsSync(result.screenshotPath)) {
        try {
            await bot.sendPhoto(chatId, result.screenshotPath, {
                caption: `📸 Screenshot — ${maskEmail(email)}`,
            });
        } catch (err) {
            console.warn(`Gagal kirim screenshot: ${err.message}`);
        }
        try { fs.unlinkSync(result.screenshotPath); } catch { /* skip */ }
    }
});

bot.onText(/^\/gen$/, async (msg) => {
    await bot.sendMessage(msg.chat.id,
        '⚠️ *Cara pakai:*\n`/gen email@domain.com`',
        { parse_mode: 'Markdown' }
    );
});

bot.on('polling_error', (err) => console.error(`Polling error: ${err.message}`));
bot.on('error', (err) => console.error(`Bot error: ${err.message}`));

console.log('🤖 Netflix AU Gen Bot started!');
