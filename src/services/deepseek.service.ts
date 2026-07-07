import axios from 'axios';
import { logger } from '../core/logger';
import { DeepSeekConfig } from '../core/types';

export class DeepSeekService {
  private readonly apiUrl = 'https://api.deepseek.com/v1/chat/completions';
  private readonly defaultModel = 'deepseek-chat';

  constructor(private config: DeepSeekConfig) {}

  async generateReadme(repoName: string, repoPath: string, fileTree: string): Promise<string> {
    logger.info(`🤖 Генерация README для ${repoName} через DeepSeek`);

    const prompt = this.buildReadmePrompt(repoName, fileTree);

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.config.model || this.defaultModel,
          messages: [
            {
              role: 'system',
              content:
                'Ты — профессиональный технический писатель. Создавай README.md для GitHub проектов в формате Markdown. Будь информативен, структурирован и лаконичен.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: this.config.temperature ?? 0.3,
          max_tokens: this.config.maxTokens ?? 2500,
        },
        {
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        },
      );

      const content = response.data.choices[0].message.content;
      logger.success(`README для ${repoName} сгенерирован`);
      return content;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        logger.error(`Ошибка DeepSeek API (${status}): ${JSON.stringify(data)}`);
        throw new Error(`DeepSeek API error: ${status} ${JSON.stringify(data)}`);
      }
      throw error;
    }
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

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.config.model || this.defaultModel,
          messages: [
            {
              role: 'system',
              content: 'Ты — эксперт по созданию документов для GitHub.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.5,
          max_tokens: 3000,
        },
        {
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        },
      );

      return response.data.choices[0].message.content;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        logger.error(`Ошибка DeepSeek API (${status}): ${JSON.stringify(data)}`);
        throw new Error(`DeepSeek API error: ${status} ${JSON.stringify(data)}`);
      }
      throw error;
    }
  }

  async generateRepoShortDescription(repoName: string, fileTree: string): Promise<string> {
    const prompt = `Опиши кратко (1-3 предложения) назначение проекта "${repoName}".

Структура файлов проекта:
${fileTree}

Ответь ТОЛЬКО кратким описанием, без лишнего текста, без заголовков и Markdown-разметки.`;

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.config.model || this.defaultModel,
          messages: [
            { role: 'system', content: 'Ты — технический аналитик. Отвечай строго одним кратким предложением.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 300,
        },
        {
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      const content = response.data.choices[0].message.content.trim();
      logger.success(`Краткое описание для ${repoName} получено`);
      return content;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        logger.error(`Ошибка DeepSeek API (${status}): ${JSON.stringify(data)}`);
      }
      throw error;
    }
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

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.config.model || this.defaultModel,
          messages: [
            {
              role: 'system',
              content: 'Ты — технический писатель. Создавай информативные описания проектов.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.4,
          max_tokens: 800,
        },
        {
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 45000,
        },
      );

      const content = response.data.choices[0].message.content.trim();
      logger.success(`Подробное описание для ${repoName} получено`);
      return content;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        logger.error(`Ошибка DeepSeek API (${status}): ${JSON.stringify(data)}`);
      }
      throw error;
    }
  }

  async generateProfileReadme(username: string, repos: Array<{ name: string; description: string; detailedDescription: string; url: string; language: string; stars: number; favorite: boolean }>): Promise<string> {
    const favorites = repos.filter(r => r.favorite);
    const others = repos.filter(r => !r.favorite);

    let prompt = `Создай README.md для GitHub профиля пользователя "${username}".

Этот профиль содержит проекты пользователя.`;

    if (favorites.length > 0) {
      prompt += `\n\n⭐ ИЗБРАННЫЕ ПРОЕКТЫ (их нужно описать максимально подробно, поместить первыми):\n${favorites.map(r =>
        `- ${r.name}: ${r.description}\n  Подробно: ${r.detailedDescription}\n  Ссылка: ${r.url}`
      ).join('\n')}`;
    }

    if (others.length > 0) {
      prompt += `\n\n📦 ОСТАЛЬНЫЕ ПРОЕКТЫ (кратко, одним блоком):\n${others.map(r =>
        `- ${r.name}: ${r.description} — ${r.language || 'N/A'} — ★${r.stars} — ${r.url}`
      ).join('\n')}`;
    }

    prompt += `\n\nПравила:
- Только секции с проектами. Никаких инструкций, placeholders, "как пользоваться"
- Избранные проекты — в отдельной секции с эмодзи ⭐, каждый с подробным описанием
- Остальные — в секции 📦, компактным списком
- В начале — приветствие от имени ${username} как разработчика (3-5 предложений, дружелюбно, с эмодзи)
- Ответ — чистый Markdown, без лишнего текста вне структуры`;

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.config.model || this.defaultModel,
          messages: [
            {
              role: 'system',
              content: 'Ты — профессиональный разработчик, создающий привлекательный GitHub профиль.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.5,
          max_tokens: 4000,
        },
        {
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 90000,
        },
      );

      const content = response.data.choices[0].message.content.trim();
      logger.success(`Профильный README для ${username} сгенерирован`);
      return content;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        logger.error(`Ошибка DeepSeek API (${status}): ${JSON.stringify(data)}`);
        throw new Error(`DeepSeek API error: ${status} ${JSON.stringify(data)}`);
      }
      throw error;
    }
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