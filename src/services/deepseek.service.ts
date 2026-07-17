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
    instructions?: string,
    contacts?: { telegram?: string; hh?: string; github?: string; email?: string; phone?: string; linkedin?: string; website?: string; habr?: string; leetcode?: string },
  ): Promise<string> {
    const favorites = repos.filter(r => r.favorite);

    const parts: string[] = [];

    // Пользовательские инструкции (если есть)
    const userNotes = instructions
      ? `\n\nДОПОЛНИТЕЛЬНЫЕ ПОЖЕЛАНИЯ ПОЛЬЗОВАТЕЛЯ (учти их обязательно):\n${instructions}\n`
      : '';

    // Шаг 1: вступление + избранные проекты (если есть)
    if (favorites.length > 0) {
      const introPrompt = `Твоя задача — создать Markdown-разметку для GitHub профиля пользователя "${username}".${userNotes}

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

    // Вставка бейджей контактов после вступления / избранных
    const badges = this.buildContactBadges(username, contacts);
    if (badges) {
      parts.push(badges);
    }

    const content = parts.join('\n\n');

    logger.success(`Профильный README для ${username} сгенерирован`);
    return content;
  }

  /**
   * Собирает Markdown-бейджи из контактов (shields.io)
   */
  private buildContactBadges(username: string, contacts?: { telegram?: string; hh?: string; github?: string; email?: string; phone?: string; linkedin?: string; website?: string; habr?: string; leetcode?: string }): string {
    if (!contacts) return '';

    const badges: string[] = [];

    if (contacts.telegram) {
      const tg = contacts.telegram.replace(/^@/, '');
      badges.push(`<a href="https://t.me/${tg}"><img src="https://img.shields.io/badge/Telegram-${encodeURIComponent('@' + tg)}-26A5E4?logo=telegram&style=for-the-badge" alt="Telegram"></a>`);
    }

    if (contacts.github) {
      const gh = contacts.github || username;
      badges.push(`<a href="https://github.com/${gh}"><img src="https://img.shields.io/badge/GitHub-${encodeURIComponent(gh)}-181717?logo=github&style=for-the-badge" alt="GitHub"></a>`);
    }

    if (contacts.hh) {
      badges.push(`<a href="${contacts.hh}"><img src="https://img.shields.io/badge/HeadHunter-Резюме-D6001C?logo=headhunter&style=for-the-badge" alt="HeadHunter"></a>`);
    }

    if (contacts.email) {
      badges.push(`<a href="mailto:${contacts.email}"><img src="https://img.shields.io/badge/Email-${encodeURIComponent(contacts.email)}-D14836?logo=maildotru&style=for-the-badge" alt="Email"></a>`);
    }

    if (contacts.phone) {
      badges.push(`<a href="tel:${encodeURIComponent(contacts.phone)}"><img src="https://img.shields.io/badge/Phone-${encodeURIComponent(contacts.phone)}-25D366?logo=whatsapp&style=for-the-badge" alt="Phone"></a>`);
    }

    if (contacts.linkedin) {
      badges.push(`<a href="https://linkedin.com/in/${contacts.linkedin}"><img src="https://img.shields.io/badge/LinkedIn-${encodeURIComponent(contacts.linkedin)}-0A66C2?logo=linkedin&style=for-the-badge" alt="LinkedIn"></a>`);
    }

    if (contacts.website) {
      const domain = contacts.website.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      badges.push(`<a href="${contacts.website}"><img src="https://img.shields.io/badge/Website-${encodeURIComponent(domain)}-4285F4?logo=google-chrome&style=for-the-badge" alt="Website"></a>`);
    }

    if (contacts.habr) {
      badges.push(`<a href="https://habr.com/users/${contacts.habr}"><img src="https://img.shields.io/badge/Habr-${encodeURIComponent(contacts.habr)}-65A3BE?logo=habr&style=for-the-badge" alt="Habr"></a>`);
    }

    if (contacts.leetcode) {
      badges.push(`<a href="https://leetcode.com/${contacts.leetcode}"><img src="https://img.shields.io/badge/LeetCode-${encodeURIComponent(contacts.leetcode)}-FFA116?logo=leetcode&style=for-the-badge" alt="LeetCode"></a>`);
    }

    if (badges.length === 0) return '';

    return `\n<div align="center">\n  ${badges.join('\n  ')}\n</div>\n`;
  }

  /**
   * Группирует репозитории по категориям на основе названия, языка и описания
   */
  private groupReposByCategory(repos: Array<{ name: string; description: string; url: string; language: string; stars: number; favorite: boolean }>): Record<string, typeof repos> {
    const groups: Record<string, typeof repos> = {};

    for (const repo of repos) {
      const category = this.detectCategory(repo);
      if (!groups[category]) groups[category] = [];
      groups[category].push(repo);
    }

    return groups;
  }

  /**
   * Определяет категорию репозитория
   */
  private detectCategory(repo: { name: string; description: string; language: string }): string {
    const name = repo.name.toLowerCase();
    const desc = repo.description.toLowerCase();
    const lang = repo.language?.toLowerCase() || '';

    if (name.includes('react') || desc.includes('react')) {
      if (name.includes('router') || desc.includes('router')) return '🌐 Роутинг (React Router)';
      if (name.includes('hook') || desc.includes('hook') || desc.includes('хук')) return '⚛️ React Hooks';
      if (name.includes('lifecycle') || desc.includes('lifecycle') || desc.includes('жизнен')) return '⚛️ React Жизненный цикл';
      if (name.includes('hoc') || desc.includes('hoc') || name.includes('decorator') || desc.includes('декоратор') || desc.includes('hoc')) return '🧩 HOC & Декораторы';
      if (name.includes('component') || desc.includes('component')) return '⚛️ React Компоненты';
      if (name.includes('state') || desc.includes('state')) return '⚛️ React Управление состоянием';
      if (name.includes('fitness') || desc.includes('fitness') || name.includes('tracker') || desc.includes('трекер')) return '⚛️ React Приложения';
      return '⚛️ React Проекты';
    }

    if (lang === 'javascript' && (name.includes('http') || name.includes('server') || name.includes('client') || name.includes('chat') || desc.includes('http') || desc.includes('сервер'))) {
      if (name.includes('chat') || desc.includes('chat') || desc.includes('чат')) return '💬 Серверные приложения';
      return '📡 HTTP & Серверы';
    }

    if (name.includes('webpack') || name.includes('babel') || name.includes('eslint') || name.includes('npm') || desc.includes('webpack') || desc.includes('babel') || desc.includes('eslint')) return '🔧 Сборка и линтеры';
    if (lang === 'typescript' || name.includes('typescript') || name.includes('ts')) return '💻 TypeScript';
    if (name.includes('dom') || desc.includes('dom') || desc.includes('браузер') || desc.includes('игра') || name.includes('game')) return '🎮 DOM & Игры';
    if (name.includes('async') || name.includes('await') || name.includes('promise') || desc.includes('async') || desc.includes('promise') || desc.includes('асинхр')) return '⏳ Асинхронность';
    if (name.includes('map') || name.includes('set') || name.includes('symbol') || name.includes('destructur') || name.includes('forin') || name.includes('method') || name.includes('class') || name.includes('inherit') || name.includes('arraybuffer') || name.includes('math') || name.includes('log') || name.includes('trig') || name.includes('newtype') || name.includes('generator')) return '🗂️ Основы JavaScript';
    if (name.includes('test') || name.includes('spec') || name.includes('matcher') || desc.includes('тест') || desc.includes('test')) return '🧪 Тестирование';
    if (name.includes('diplom') || name.includes('diploma') || desc.includes('диплом')) return '📊 Дипломные проекты';
    if (name.includes('form') || name.includes('bootstrap') || name.includes('layout') || name.includes('listing') || name.includes('filter') || name.includes('convert') || name.includes('stars') || name.includes('hex')) return '🎨 UI Компоненты';
    if (name.includes('template') || name.includes('import') || name.includes('export') || name.includes('module')) return '📦 Модули & Импорт';
    if (name.includes('git') || name.includes('merge') || name.includes('revert') || name.includes('neuro')) return '🔀 Git & Контроль версий';

    return '📁 Прочие проекты';
  }

  /**
   * Собирает промпт для генерации таблиц по категориям
   */
  private buildCategoryTablePrompt(
    username: string,
    categories: Array<[string, Array<{ name: string; description: string; url: string }>]>,
    isFirst: boolean,
    partNum: number,
    totalParts: number,
  ): string {
    let prompt = '';

    if (isFirst) {
      prompt += `Создай раздел с проектами для GitHub профиля "${username}".

Каждая категория — Markdown-таблица с колонками: Проект | Описание | Ссылка

Пример:
## ⚛️ Название категории
| Проект | Описание | Ссылка |
|--------|----------|--------|
| ИмяПроекта | Суть проекта в 2-5 словах | [Перейти](url) |

`;
    } else {
      prompt += `Продолжи таблицы для GitHub профиля "${username}" (часть ${partNum}/${totalParts}).

Формат:
## ⚛️ Категория
| Проект | Описание | Ссылка |
|--------|----------|--------|
| ИмяПроекта | Кратко 2-5 слов | [Перейти](url) |

`;
    }

    prompt += `Сгенерируй таблицы:\n\n`;

    for (const [category, repos] of categories) {
      prompt += `### ${category}\n`;
      for (const repo of repos) {
        prompt += `- ${repo.name}: ${repo.description}\n  url: ${repo.url}\n`;
      }
      prompt += '\n';
    }

    prompt += `СТРОГИЕ ПРАВИЛА:
1. Категория: ## с эмодзи и названием
2. Колонки через |: Проект | Описание | Ссылка
3. В колонке Ссылка: [Перейти](url) — без пробелов
4. Описание: 2-5 слов, без многоточий, без обрезания
5. Только таблицы, никаких пояснений
6. НЕ выдумывай проекты — используй только из списка выше, каждый ровно один раз`;

    return prompt;
  }

  /**
   * Очищает ответ с таблицами — удаляет пояснения AI и битые строки
   */
  private cleanTableResponse(response: string): string {
    let cleaned = this.cleanAIResponse(response);

    const lines = cleaned.split('\n');
    const filtered = lines.filter(line => {
      if (line.includes('|')) return true;
      // Удаляем строки с "Ссылка:", "ссылк", "### " (если AI продублировал категории)
      if (line.includes('Ссылка:') || line.includes('ссылк') || line.trimLeft().startsWith('### ')) return false;
      return true;
    });

    // Удаляем "...|" в таблицах — признак обрезанного AI описания
    const fixed = filtered.map(line => line.replace(/\.\.\.\|/g, ' |').replace(/\.\.\.$/g, ''));

    return fixed.join('\n').trim();
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
        validateStatus: (status) => status >= 200 && status < 300,
      },
    );

    if (!response.data) {
      throw new DeepSeekApiError('Пустой ответ от API', 200, 'empty_response');
    }

    if (response.data.error) {
      const err = response.data.error;
      throw new DeepSeekApiError(
        err.message || 'DeepSeek вернул ошибку в теле ответа',
        200,
        err.code || 'api_error',
      );
    }

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

  private async withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const shouldRetry = this.isRetryableError(error);

        if (!shouldRetry || attempt === this.maxRetries) {
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

        const delay = this.baseDelay * Math.pow(2, attempt - 1);
        logger.warn(`⚠️ Retry ${attempt}/${this.maxRetries} для ${label} через ${delay}ms...`);
        await this.sleep(delay);
      }
    }

    throw lastError || new Error('Неизвестная ошибка');
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof DeepSeekApiError) return false;

    if (axios.isAxiosError(error)) {
      const axiosErr = error as AxiosError;
      const status = axiosErr.response?.status;
      if (!status) return true;
      if (status === 429) return true;
      if (status >= 500 && status < 600) return true;
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private cleanAIResponse(response: string): string {
    const hashIndex = response.indexOf('#');
    if (hashIndex > 0) {
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