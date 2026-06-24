FROM node:20-alpine

RUN apk add --no-cache git

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY .env.example ./.env

# Сборка TypeScript
RUN npx tsc

# Удаляем dev-зависимости
RUN npm prune --omit=dev

# Порт веб-интерфейса
EXPOSE 3000

ENV GIT_USER_NAME=gh-manager
ENV GIT_USER_EMAIL=gh-manager@local

CMD ["node", "dist/server/index.js"]