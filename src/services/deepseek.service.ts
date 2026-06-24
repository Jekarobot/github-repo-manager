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