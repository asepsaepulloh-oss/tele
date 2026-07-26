FROM node:20-bookworm

# Install Chromium dan dependency sistem yang dibutuhkan Playwright
RUN npx playwright install --with-deps chromium

WORKDIR /app

# Salin package.json dan install dependencies Node.js
COPY package*.json ./
RUN npm ci

# Salin seluruh file project
COPY . .

# Jalankan bot
ENTRYPOINT ["node", "index.js"]
