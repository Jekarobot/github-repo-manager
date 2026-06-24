// src/services/sanitizer.service.ts
import * as fs from "fs/promises";
import * as path from "path";
import { SanitizationRule } from "../core/types";
import { logger } from "../core/logger";

export class SanitizerService {
  private defaultRules: SanitizationRule[] = [
    // Удаление упоминаний компаний
    {
      pattern:
        /\b(?:ООО|ОАО|ЗАО|ИП|LLC|Inc|Corp|Ltd)\s+["']?([A-ZА-Я][a-zа-я]+(?:[\s-][A-ZА-Я][a-zа-я]+)*)["']?/gi,
      replacement: "[COMPANY_NAME]",
      description: "Удаление названий компаний",
    },
    // Удаление имен сотрудников
    {
      pattern:
        /\b(?:разработал|создал|написал|implemented|developed|created by)\s+([A-ZА-Я][a-zа-я]+\s+[A-ZА-Я][a-zа-я]+)/gi,
      replacement: "[DEVELOPER]",
      description: "Удаление имен разработчиков",
    },
    // Удаление email
    {
      pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      replacement: "[EMAIL]",
      description: "Удаление email адресов",
    },
    // Удаление внутренних URL
    {
      pattern:
        /(?:https?:\/\/)?(?:[\w-]+\.)*(?:internal|corp|company|intranet)[\w-]*\.[a-z]{2,}(?:\/[\w-./?%&=]*)?/gi,
      replacement: "[INTERNAL_URL]",
      description: "Удаление внутренних URL",
    },
    // Удаление специфических путей
    {
      pattern:
        /(?:\\|\/)(?:home|users|user|home|Documents|Desktop)[\\\/][A-Za-z0-9_-]+/gi,
      replacement: "/[USER_PATH]",
      description: "Удаление пользовательских путей",
    },
    // Удаление номеров проектов/задач
    {
      pattern: /\b(?:PROJ|PRJ|TASK|JIRA|BUG|TICKET)-?\d{4,}\b/gi,
      replacement: "[PROJECT_ID]",
      description: "Удаление идентификаторов проектов",
    },
    // Удаление IP адресов
    {
      pattern: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,
      replacement: "[IP_ADDRESS]",
      description: "Удаление IP адресов",
    },
    // Удаление внутренних API ключей
    {
      pattern:
        /(?:api[_-]?key|token|secret|password|auth)[\s]*[:=][\s]*["']?[A-Za-z0-9_\-\.]{8,}["']?/gi,
      replacement: "[API_KEY]",
      description: "Удаление API ключей",
    },
  ];

  private fileExtensions = {
    code: [
      ".js",
      ".ts",
      ".py",
      ".go",
      ".rs",
      ".java",
      ".cpp",
      ".c",
      ".h",
      ".cs",
      ".php",
      ".rb",
    ],
    config: [".json", ".yaml", ".yml", ".toml", ".ini", ".env", ".xml"],
    docs: [".md", ".txt", ".rst", ".adoc"],
    all: [] as string[],
  };

  constructor(private customRules: SanitizationRule[] = []) {
    this.fileExtensions.all = [
      ...this.fileExtensions.code,
      ...this.fileExtensions.config,
      ...this.fileExtensions.docs,
    ];
  }

  async sanitizeRepository(
    repoPath: string,
  ): Promise<{ sanitizedFiles: number; changes: string[] }> {
    logger.info(`🧹 Начинаю обезличивание репозитория: ${repoPath}`);

    const allRules = [...this.defaultRules, ...this.customRules];
    let sanitizedFiles = 0;
    const changes: string[] = [];

    await this.walkDirectory(repoPath, async (filePath: string) => {
      const ext = path.extname(filePath).toLowerCase();

      // Проверяем, нужно ли обрабатывать файл
      if (!this.shouldSanitizeFile(filePath)) return;

      try {
        const content = await fs.readFile(filePath, "utf-8");
        let newContent = content;
        let fileChanged = false;

        for (const rule of allRules) {
          const matches = newContent.match(rule.pattern);
          if (matches && matches.length > 0) {
            newContent = newContent.replace(rule.pattern, rule.replacement);
            fileChanged = true;
            changes.push(
              `[${path.basename(filePath)}] ${rule.description}: ${matches.length} замен`,
            );
          }
        }

        if (fileChanged) {
          await fs.writeFile(filePath, newContent, "utf-8");
          sanitizedFiles++;
        }
      } catch (error) {
        logger.warn(`⚠️ Не удалось обработать файл ${filePath}:`, error);
      }
    });

    logger.info(`✅ Обезличено ${sanitizedFiles} файлов`);
    return { sanitizedFiles, changes };
  }

  private shouldSanitizeFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);

    // Пропускаем бинарные файлы
    const binaryExtensions = [
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".ico",
      ".svg",
      ".pdf",
      ".zip",
      ".tar",
      ".gz",
    ];
    if (binaryExtensions.includes(ext)) return false;

    // Пропускаем .git
    if (filePath.includes(".git")) return false;

    // Проверяем расширение
    return (
      this.fileExtensions.all.includes(ext) ||
      fileName === "Dockerfile" ||
      fileName === "Makefile" ||
      !ext
    ); // Файлы без расширения (например, Dockerfile)
  }

  private async walkDirectory(
    dir: string,
    callback: (file: string) => Promise<void>,
  ): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await this.walkDirectory(fullPath, callback);
      } else {
        await callback(fullPath);
      }
    }
  }

  async addCustomRules(rules: SanitizationRule[]): Promise<void> {
    this.customRules = [...this.customRules, ...rules];
    logger.info(`📋 Добавлено ${rules.length} пользовательских правил`);
  }

  async previewChanges(
    repoPath: string,
  ): Promise<{ file: string; matches: string[] }[]> {
    const preview: { file: string; matches: string[] }[] = [];
    const allRules = [...this.defaultRules, ...this.customRules];

    await this.walkDirectory(repoPath, async (filePath: string) => {
      if (!this.shouldSanitizeFile(filePath)) return;

      try {
        const content = await fs.readFile(filePath, "utf-8");
        const matches: string[] = [];

        for (const rule of allRules) {
          const found = content.match(rule.pattern);
          if (found) {
            matches.push(...found.map((m) => `${rule.description}: "${m}"`));
          }
        }

        if (matches.length > 0) {
          preview.push({ file: filePath, matches: matches.slice(0, 5) });
        }
      } catch (error) {
        // skip
      }
    });

    return preview;
  }
}
