FROM node:20-bookworm

WORKDIR /app

# 1. Salin package.json dan package-lock.json (jika ada) terlebih dahulu
COPY package*.json ./

# 2. Install dependencies menggunakan npm install (lebih fleksibel jika belum ada lockfile)
RUN npm install

# 3. Install Playwright dan dependensi browser-nya
RUN npx playwright install --with-deps chromium

# 4. Salin seluruh sisa file project ke dalam container
COPY . .

# 5. Jalankan bot
ENTRYPOINT ["node", "index.js"]
