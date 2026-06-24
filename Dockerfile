FROM node:20-alpine

RUN apk add --no-cache git

WORKDIR /app

# Копируем package.json и устанавливаем ВСЕ зависимости (включая dev для сборки)
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

# Копируем исходники
COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY .env.example ./.env

# Сборка TypeScript
RUN npx tsc

# Удаляем dev-зависимости для уменьшения образа
RUN npm prune --omit=dev

# Порт веб-интерфейса
EXPOSE 3000

# Запускаем скомпилированную версию
CMD ["node", "dist/server/index.js"]