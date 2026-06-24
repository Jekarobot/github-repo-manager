# GitHub Repo Manager 🚀

Управление GitHub репозиториями: автоматическая генерация README через DeepSeek API, обезличивание кода и пуш изменений.

## Возможности

- 🌐 **Веб-интерфейс** — управление репозиториями через браузер (порт 3000)
- 📥 **Клонирование** репозиториев из конфигурационного файла
- 📝 **Генерация README.md** через DeepSeek AI (на основе структуры файлов проекта)
- 🧹 **Обезличивание кода** — удаление имен, email, API ключей, IP адресов (опционально, по флагу `--sanitize`)
- 📤 **Push** изменений с подтверждением (опционально, по флагу `--push`)
- 📄 **Сводный файл** PROJECTS.md со всеми проектами
- ⚡ **Параллельная обработка** (настраивается, по умолчанию 3)
- 🔍 **Preview** режим для просмотра изменений без применения
- 🐳 **Docker** — запуск в контейнере фоном

## Установка

### Локально

```bash
# Клонировать репозиторий
git clone https://github.com/yourusername/github-repo-manager.git
cd github-repo-manager

# Установить зависимости
npm install

# Скопировать и настроить .env
cp .env.example .env
# Отредактировать .env — добавить DEEPSEEK_API_KEY

# Скопировать и настроить конфиг
cp repos.config.example.json repos.config.json
# Отредактировать repos.config.json — добавить свои репозитории
```

### Docker

```bash
# Собрать и запустить
docker compose up -d

# Проверить: http://localhost:3000

# Остановить
docker compose down
```

## Использование

### Веб-интерфейс (рекомендуется)

```bash
# Запуск веб-сервера
npm run web
# Открыть http://localhost:3000
```

В веб-интерфейсе три вкладки:
1. **📦 Репозитории** — просмотр, добавление и удаление репо через форму
2. **⚙️ Запуск** — настройка флагов и запуск обработки
3. **📋 Логи** — live-лог через SSE в реальном времени

### CLI

```bash
# Базовый запуск
npx tsx src/cli/index.ts process

# С флагами
npx tsx src/cli/index.ts process --sanitize --skip-existing --push

# Параллельная обработка 5 репозиториев
npx tsx src/cli/index.ts process --parallel 5

# Просмотр изменений без применения
npx tsx src/cli/index.ts process --preview

# Создать пример конфига
npx tsx src/cli/index.ts init
```

### CLI флаги

| Флаг | По умолчанию | Описание |
|---|---|---|
| `--config <path>` | `./repos.config.json` | Путь к конфигу |
| `--parallel <n>` | `3` | Параллельных потоков |
| `--sanitize` | отключено | Включить обезличивание |
| `--skip-existing` | отключено | Пропускать репо с существующим README.md |
| `--push` | отключено | Показать diff и спросить апрув на пуш |
| `--auto-push` | отключено | Пушить без подтверждения |
| `--preview` | отключено | Показать что будет сделано |

## Конфигурация

### `.env`

```env
# Обязательно
DEEPSEEK_API_KEY=your_deepseek_api_key

# Опционально (для пуша через HTTPS)
GITHUB_TOKEN=your_github_token

# Опционально (путь к конфигу в веб-режиме)
CONFIG_PATH=./repos.config.json

# Опционально (порт веб-сервера)
PORT=3000
```

### `repos.config.json`

```json
{
  "workDir": "./temp_repos",
  "summaryFile": "./PROJECTS.md",
  "maxConcurrent": 3,
  "repositories": [
    {
      "url": "https://github.com/username/repo.git",
      "skipIfReadmeExists": true,
      "sanitize": false,
      "push": false,
      "branch": "main"
    }
  ]
}
```

Репозитории можно добавлять/удалять как через веб-интерфейс, так и напрямую редактируя этот файл — оба способа работают.

## Архитектура

```
src/
├── core/
│   ├── config.ts              # Загрузка и валидация конфига
│   ├── logger.ts              # Логирование
│   └── types.ts               # TypeScript типы
├── services/
│   ├── deepseek.service.ts    # DeepSeek API интеграция
│   ├── readme.service.ts      # Генерация README
│   ├── repository.service.ts  # Оркестрация обработки
│   ├── sanitizer.service.ts   # Обезличивание кода
│   ├── summary.service.ts     # Сводный файл
│   └── push.service.ts        # Push с подтверждением
├── server/
│   ├── index.ts               # Express сервер
│   ├── routes/api.ts          # REST API (6 эндпоинтов)
│   └── middleware/sse.ts      # Server-Sent Events для live-логов
├── cli/
│   └── index.ts               # CLI точка входа
└── index.ts                   # Главный экспорт

public/                        # SPA
├── index.html
├── style.css
└── app.js
```

## Требования

- Node.js >= 18
- Git
- DeepSeek API ключ (бесплатно на [platform.deepseek.com](https://platform.deepseek.com))

## Лицензия

MIT