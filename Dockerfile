FROM node:20-alpine

RUN apk add --no-cache git

WORKDIR /app

# Сначала копируем package.json для кэширования слоя с зависимостями
COPY package.json package-lock.json ./
RUN npm ci --only=production && npm cache clean --force

# Копируем исходники
COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY .env.example ./.env

# Сборка
RUN npx tsc

# Порт веб-интерфейса
EXPOSE 3000

# По умолчанию запускаем веб-сервер
CMD ["node", "dist/server/index.js"]