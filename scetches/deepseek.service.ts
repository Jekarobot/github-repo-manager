// src/services/deepseek.service.ts
import axios from "axios";
import { logger } from "../core/logger";

export interface DeepSeekConfig {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export class DeepSeekService {
  private readonly apiUrl = "https://api.deepseek.com/v1/chat/completions";
  private readonly defaultModel = "deepseek-chat";

  constructor(private config: DeepSeekConfig) {}

  async generateReadme(repoName: string, context: string): Promise<string> {
    logger.info(`🤖 Генерация README для ${repoName} через DeepSeek`);

    const prompt = this.buildPrompt(repoName, context);

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.config.model || this.defaultModel,
          messages: [
            {
              role: "system",
              content:
                "Ты — профессиональный технический писатель. Создавай README.md для GitHub проектов в формате Markdown. Будь информативен, структурирован и профессионален.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: this.config.temperature || 0.3,
          max_tokens: this.config.maxTokens || 2500,
        },
        {
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      const content = response.data.choices[0].message.content;
      logger.info(`✅ README для ${repoName} сгенерирован`);
      return content;
    } catch (error) {
      logger.error(`❌ Ошибка генерации README для ${repoName}:`, error);
      throw error;
    }
  }

  private buildPrompt(repoName: string, context: string): string {
    return `# Задача: Создать README.md для проекта "${repoName}"

## Контекст проекта (первые строки файлов):
${context}

## Требования к README:
1. **Название проекта** — на основе имени репозитория
2. **Краткое описание** — что делает проект, его основная цель
3. **Технологический стек** — языки, фреймворки, библиотеки
4. **Установка и запуск** — пошаговая инструкция
5. **Использование** — примеры кода или команд
6. **Структура проекта** — описание основных директорий
7. **Лицензия** — если есть, иначе стандартная

## Формат:
- Используй Markdown
- Добавь эмодзи для секций (🚀, 📦, 💻 и т.д.)
- Будь лаконичен, но информативен
- Не добавляй лишнего текста вне структуры README

## Ограничения:
- Не упоминай конкретные компании или имена разработчиков
- Не раскрывай конфиденциальную информацию
- Если не уверен в чем-то, используй [PLACEHOLDER]

Создай README.md:`;
  }

  async generateSummary(
    projects: Array<{ name: string; description: string; url: string }>,
  ): Promise<string> {
    const prompt = `
    Создай файл оглавления для GitHub профиля со всеми проектами.
    
    Список проектов:
    ${projects.map((p) => `- ${p.name}: ${p.description}`).join("\n")}
    
    Требования:
    - Красивое форматирование с эмодзи
    - Группировка по технологиям (если видно по описанию)
    - Ссылки на каждый проект
    - Краткое описание каждого проекта
    
    Ответ в формате Markdown для GitHub.
    `;

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.config.model || this.defaultModel,
          messages: [
            {
              role: "system",
              content: "Ты — эксперт по созданию документов для GitHub.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.5,
          max_tokens: 3000,
        },
        {
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      return response.data.choices[0].message.content;
    } catch (error) {
      logger.error("❌ Ошибка генерации сводного файла:", error);
      throw error;
    }
  }
}
