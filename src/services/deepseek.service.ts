import axios, { AxiosError } from 'axios';
import { logger } from '../core/logger';
import { DeepSeekConfig } from '../core/types';

interface DeepSeekResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  error?: {
    message: string;
    type: string;
    param?: string;
    code?: string;
  };
}

export class DeepSeekService {
  private readonly apiUrl = 'https://api.deepseek.com/v1/chat/completions';
  private readonly defaultModel = 'deepseek-chat';
  private readonly maxRetries = 3;
  private readonly baseDelay = 1000;

  constructor(private config: DeepSeekConfig) {}

  async generateReadme(repoName: string, repoPath: string, fileTree: string): Promise<string> {
    logger.info(`🤖 Генерация README для ${repoName} через DeepSeek`);

    const prompt = this.buildReadmePrompt(repoName, fileTree);

    return this.withRetry(
      async () => {
        const content = await this.callApi(prompt, {
          temperature: this.config.temperature ?? 0.3,
          max_tokens: this.config.maxTokens ?? 2500,
          timeout: 60000,
        });
        logger.success(`README для ${repoName} сгенерирован`);
        return content;
      },
      repoName,
    );
  }

  async generateSummary(
    projects: Array<{ name: string; description: string; url: string }>,
  ): Promise<string> {
    const prompt = `Создай файл оглавления для GitHub профиля.

Проекты:
${projects.map((p) => `- ${p.name}: ${p.description} — ${p.url}`).join('\n')}

Правила:
- Только разделы со списком проектов. Никаких инструкций, подсказок, placeholders.
- Не используй "ваш-username", "ваш проект" и т.п.
- Каждый проект: ссылка на URL, краткое описание
- Группировка по технологиям с эмодзи
- Ответ — чистый Markdown, без лишнего текста`;

    return this.withRetry(
      async () => {
        return this.callApi(prompt, {
          temperature: 0.5,
          max_tokens: 3000,
          timeout: 60000,
        });
      },
      'summary',
    );
  }

  async generateRepoShortDescription(repoName: string, fileTree: string): Promise<string> {
    const prompt = `Опиши кратко (1-3 предложения) назначение проекта "${repoName}".

Структура файлов проекта:
${fileTree}

Ответь ТОЛЬКО кратким описанием, без лишнего текста, без заголовков и Markdown-разметки.`;

    return this.withRetry(
      async () => {
        return this.callApi(prompt, {
          temperature: 0.3,
          max_tokens: 300,
          timeout: 30000,
          systemPrompt: 'Ты — технический аналитик. Отвечай строго одним кратким предложением.',
        });
      },
      repoName,
    );
  }

  async generateRepoDetailedDescription(repoName: string, fileTree: string): Promise<string> {
    const prompt = `Создай подробное описание проекта "${repoName}" для GitHub профиля.

Структура файлов проекта:
${fileTree}

Требования:
1. Назначение проекта (2-3 предложения)
2. Ключевые технологии и стек
3. Архитектура и особенности реализации
4. Основные возможности
Формат: Markdown, 5-10 предложений, эмодзи для секций.`;

    return this.withRetry(
      async () => {
        return this.callApi(prompt, {
          temperature: 0.4,
          max_tokens: 800,
          timeout: 45000,
          systemPrompt: 'Ты — технический писатель. Создавай информативные описания проектов.',
        });
      },
      repoName,
    );
  }

  async generateProfileReadme(
    username: string,
    repos: Array<{ name: string; description: string; detailedDescription: string; url: string; language: string; stars: number; favorite: boolean }>,
  ): Promise<string> {
    const favorites = repos.filter(r => r.favorite);
    const others = repos.filter(r => !r.favorite);

    // Разбиваем «others» на чанки по 30 репозиториев
    const othersChunks = this.chunkArray(others, 30);

    // Результирующие части: вступление, списки проектов
    const parts: string[] = [];

    // Шаг 1: вступление + избранные проекты (если есть)
    if (favorites.length > 0) {
      const introPrompt = `Твоя задача — создать Markdown-разметку для GitHub профиля пользователя "${username}".

Оформи ПЕРВУЮ половину профиля:
1. Вступление от имени ${username} (3-5 предложений, дружелюбно, с эмодзи)
2. Секция ⭐ Избранные проекты

Избранные проекты (опиши каждый максимально подробно: технологии, архитектура, фичи):
${favorites.map(r => `- ${r.name}: ${r.description}\n  Подробно: ${r.detailedDescription}\n  Ссылка: ${r.url}`).join('\n')}

ВАЖНЫЕ ПРАВИЛА:
- Только чистый Markdown, никаких пояснений, вводных фраз, приветствий от AI
- НЕ пиши "Привет! Вот готовый текст" или подобного
- Не добавляй секцию "остальные проекты" или "все проекты"
- Заголовки начинаются с ##`;

      logger.info(`📄 Генерация секции избранных (${favorites.length} проектов)...`);
      const introResult = await this.withRetry(
        async () => this.callApi(introPrompt, {
          temperature: 0.3,
          max_tokens: 6000,
          timeout: 60000,
          systemPrompt: 'Ты — AI, который генерирует только чистый Markdown. Никаких пояснений, приветствий, «вот готовый текст». Только Markdown.',
        }),
        `${username}/intro`,
      );
      parts.push(this.cleanAIResponse(introResult));
    }

    // Шаг 2: секция с остальными проектами (по чанкам)
    if (othersChunks.length > 0) {
      // Первый чанк — с заголовком
      const firstChunk = othersChunks[0];
      const chunkPrompt = `Создай секцию "📦 Все проекты" для GitHub профиля "${username}".

Проекты:
${firstChunk.map(r => `- ${r.name}: ${r.description} — ${r.language || 'N/A'} — ★${r.stars}\n  Ссылка: ${r.url}`).join('\n')}

ВАЖНЫЕ ПРАВИЛА:
- Заголовок секции: ## 📦 Все проекты
- Компактный Markdown-список с эмодзи
- Только Markdown, никаких пояснений от AI`;

      logger.info(`📄 Генерация секции проектов (часть 1/${othersChunks.length}, ${firstChunk.length} репозиториев)...`);
      const chunkResult = await this.withRetry(
        async () => this.callApi(chunkPrompt, {
          temperature: 0.3,
          max_tokens: 4000,
          timeout: 60000,
          systemPrompt: 'Ты — AI, который генерирует только чистый Markdown. Никаких пояснений, приветствий. Только Markdown.',
        }),
        `${username}/chunk1`,
      );
      parts.push(this.cleanAIResponse(chunkResult));

      // Остальные чанки — только продолжение списка, без заголовков
      for (let i = 1; i < othersChunks.length; i++) {
        const chunk = othersChunks[i];
        const chunkNum = i + 1;

        const nextPrompt = `Продолжи список проектов (часть ${chunkNum}/${othersChunks.length}) для GitHub профиля "${username}".

Проекты (только список, без заголовка секции):
${chunk.map(r => `- ${r.name}: ${r.description} — ${r.language || 'N/A'} — ★${r.stars}\n  Ссылка: ${r.url}`).join('\n')}

ВАЖНО: ТОЛЬКО строки списка, НЕ добавляй заголовок "## 📦 Все проекты" повторно!`;

        logger.info(`📄 Генерация продолжения списка (часть ${chunkNum}/${othersChunks.length}, ${chunk.length} репозиториев)...`);
        const nextResult = await this.withRetry(
          async () => this.callApi(nextPrompt, {
            temperature: 0.3,
            max_tokens: 4000,
            timeout: 60000,
            systemPrompt: 'Ты — AI, который генерирует только Markdown-списки. Никаких заголовков секций, пояснений, приветствий.',
          }),
          `${username}/chunk${chunkNum}`,
        );
        parts.push(this.cleanAIResponse(nextResult));
      }
    }

    // Шаг 3: склеиваем все части без лишних разделителей
    const content = parts.join('\n\n');

    logger.success(`Профильный README для ${username} сгенерирован (${parts.length} частей)`);
    return content;
  }

  /**
   * Универсальный метод вызова DeepSeek API с единой обработкой ошибок
   */
  private async callApi(
    userPrompt: string,
    opts: {
      temperature: number;
      max_tokens: number;
      timeout: number;
      systemPrompt?: string;
    },
  ): Promise<string> {
    const systemPrompt = opts.systemPrompt || 'Ты — профессиональный технический писатель. Создавай документы в формате Markdown. Будь информативен, структурирован и лаконичен.';

    const response = await axios.post<DeepSeekResponse>(
      this.apiUrl,
      {
        model: this.config.model || this.defaultModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: opts.temperature,
        max_tokens: opts.max_tokens,
      },
      {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: opts.timeout,
        // Убедимся, что axios выбросит ошибку на не-2xx статусы
        validateStatus: (status) => status >= 200 && status < 300,
      },
    );

    // Валидация структуры ответа (статус 200, но тело может быть битое)
    if (!response.data) {
      throw new DeepSeekApiError('Пустой ответ от API', 200, 'empty_response');
    }

    // DeepSeek может вернуть error внутри 200-ответа
    if (response.data.error) {
      const err = response.data.error;
      throw new DeepSeekApiError(
        err.message || 'DeepSeek вернул ошибку в теле ответа',
        200,
        err.code || 'api_error',
      );
    }

    // Проверяем наличие choices
    if (!response.data.choices || !Array.isArray(response.data.choices) || response.data.choices.length === 0) {
      const dataPreview = JSON.stringify(response.data).substring(0, 500);
      throw new DeepSeekApiError(
        `Ответ API не содержит choices. Тело: ${dataPreview}`,
        200,
        'no_choices',
      );
    }

    const choice = response.data.choices[0];
    if (!choice.message || typeof choice.message.content !== 'string') {
      throw new DeepSeekApiError(
        `Ответ API содержит некорректную структуру message. choice: ${JSON.stringify(choice).substring(0, 300)}`,
        200,
        'invalid_message_structure',
      );
    }

    const content = choice.message.content.trim();
    if (!content) {
      throw new DeepSeekApiError('Пустой content в ответе API', 200, 'empty_content');
    }

    return content;
  }

  /**
   * Выполняет запрос с повторными попытками при временных ошибках
   */
  private async withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const shouldRetry = this.isRetryableError(error);

        if (!shouldRetry || attempt === this.maxRetries) {
          // Неповторяемая ошибка или исчерпаны попытки
          if (error instanceof DeepSeekApiError) {
            logger.error(`❌ DeepSeek API ошибка (${error.statusCode}):`, {
              message: error.apiMessage,
              code: error.errorCode,
              detail: error.message,
            });
          } else if (axios.isAxiosError(error)) {
            const axiosErr = error as AxiosError;
            logger.error(`❌ Сетевая ошибка DeepSeek API (попытка ${attempt}/${this.maxRetries}):`, {
              status: axiosErr.response?.status,
              statusText: axiosErr.response?.statusText,
              code: axiosErr.code,
              message: axiosErr.message,
              data: axiosErr.response?.data ? String(axiosErr.response.data).substring(0, 500) : 'нет данных',
              url: axiosErr.config?.url,
            });
          } else {
            logger.error(`❌ Неизвестная ошибка DeepSeek API (${label}):`, lastError.message);
          }
          throw lastError;
        }

        // Задержка с exponential backoff
        const delay = this.baseDelay * Math.pow(2, attempt - 1);
        logger.warn(`⚠️ Retry ${attempt}/${this.maxRetries} для ${label} через ${delay}ms...`);
        await this.sleep(delay);
      }
    }

    throw lastError || new Error('Неизвестная ошибка');
  }

  /**
   * Определяет, можно ли повторить запрос
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof DeepSeekApiError) {
      // Не повторяем ошибки структуры ответа (200 с битыми данными)
      return false;
    }

    if (axios.isAxiosError(error)) {
      const axiosErr = error as AxiosError;
      const status = axiosErr.response?.status;

      // Сетевые ошибки без ответа — повторяем
      if (!status) return true;

      // 429 Too Many Requests — повторяем
      if (status === 429) return true;

      // 5xx — повторяем
      if (status >= 500 && status < 600) return true;
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Очищает ответ AI от пояснений — оставляет только Markdown, начиная с первого #
   * Если # не найден — возвращает как есть
   */
  private cleanAIResponse(response: string): string {
    const hashIndex = response.indexOf('#');
    if (hashIndex > 0) {
      // Отрезаем всё до первого заголовка
      return response.substring(hashIndex).trim();
    }
    return response;
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private buildReadmePrompt(repoName: string, fileTree: string): string {
    return `Создай README.md для проекта "${repoName}".

Структура файлов проекта:
${fileTree}

Требования к README:
1. Название проекта на основе имени репозитория
2. Краткое описание цели проекта
3. Технологический стек (языки, фреймворки, библиотеки)
4. Инструкция по установке и запуску
5. Примеры использования (код или команды)
6. Структура проекта
7. Лицензия

Формат:
- Markdown
- Эмодзи для секций
- Лаконично, но информативно
- Не добавляй лишнего текста вне структуры README`;
  }
}

/**
 * Специализированный класс ошибок для DeepSeek API
 */
class DeepSeekApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errorCode: string,
    public readonly apiMessage?: string,
  ) {
    super(`${message} (status=${statusCode}, code=${errorCode})`);
    this.name = 'DeepSeekApiError';
  }
}