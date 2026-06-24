import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../core/logger';

interface SanitizationRule {
  pattern: RegExp;
  replacement: string;
  description: string;
}

export class SanitizerService {
  private defaultRules: SanitizationRule[] = [
    {
      pattern: /\b(?:ООО|ОАО|ЗАО|ИП|LLC|Inc|Corp|Ltd)\s+["']?([A-ZА-Я][a-zа-я]+(?:[\s-][A-ZА-Я][a-zа-я]+)*)["']?/gi,
      replacement: '[COMPANY_NAME]',
      description: 'Удаление названий компаний',
    },
    {
      pattern: /\b(?:разработал|создал|написал|implemented|developed|created by)\s+([A-ZА-Я][a-zа-я]+\s+[A-ZА-Я][a-zа-я]+)/gi,
      replacement: '[DEVELOPER]',
      description: 'Удаление имен разработчиков',
    },
    {
      pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      replacement: '[EMAIL]',
      description: 'Удаление email адресов',
    },
    {
      pattern: /(?:https?:\/\/)?(?:[\w-]+\.)*(?:internal|corp|company|intranet)[\w-]*\.[a-z]{2,}(?:\/[\w-./?%&=]*)?/gi,
      replacement: '[INTERNAL_URL]',
      description: 'Удаление внутренних URL',
    },
    {
      pattern: /(?:\\|\/)(?:home|users|user|Documents|Desktop)[\\\/][A-Za-z0-9_-]+/gi,
      replacement: '/[USER_PATH]',
      description: 'Удаление пользовательских путей',
    },
    {
      pattern: /\b(?:PROJ|PRJ|TASK|JIRA|BUG|TICKET)-?\d{4,}\b/gi,
      replacement: '[PROJECT_ID]',
      description: 'Удаление идентификаторов проектов',
    },
    {
      pattern: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,
      replacement: '[IP_ADDRESS]',
      description: 'Удаление IP адресов',
    },
    {
      pattern: /(?:api[_-]?key|token|secret|password|auth)[\s]*[:=][\s]*["']?[A-Za-z0-9_\-\.]{8,}["']?/gi,
      replacement: '[API_KEY]',
      description: 'Удаление API ключей',
    },
  ];

  async sanitizeRepository(repoPath: string): Promise<{ sanitizedFiles: number; changes: string[] }> {
    logger.info(`🧹 Начинаю обезличивание: ${repoPath}`);

    let sanitizedFiles = 0;
    const changes: string[] = [];

    await this.walkDirectory(repoPath, async (filePath: string) => {
      if (!this.shouldSanitizeFile(filePath)) return;

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        let newContent = content;
        let fileChanged = false;

        for (const rule of this.defaultRules) {
          const matches = newContent.match(rule.pattern);
          if (matches && matches.length > 0) {
            newContent = newContent.replace(rule.pattern, rule.replacement);
            fileChanged = true;
            changes.push(`[${path.basename(filePath)}] ${rule.description}: ${matches.length} замен`);
          }
        }

        if (fileChanged) {
          await fs.writeFile(filePath, newContent, 'utf-8');
          sanitizedFiles++;
        }
      } catch {
        // Пропускаем бинарные файлы
      }
    });

    logger.success(`🧹 Обезличено ${sanitizedFiles} файлов`);
    return { sanitizedFiles, changes };
  }

  async previewChanges(repoPath: string): Promise<{ file: string; matches: string[] }[]> {
    const preview: { file: string; matches: string[] }[] = [];

    await this.walkDirectory(repoPath, async (filePath: string) => {
      if (!this.shouldSanitizeFile(filePath)) return;

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const matches: string[] = [];

        for (const rule of this.defaultRules) {
          const found = content.match(rule.pattern);
          if (found) {
            matches.push(...found.map((m) => `${rule.description}: "${m}"`));
          }
        }

        if (matches.length > 0) {
          preview.push({
            file: path.relative(repoPath, filePath),
            matches: matches.slice(0, 5),
          });
        }
      } catch {
        // skip
      }
    });

    return preview;
  }

  private shouldSanitizeFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();

    // Пропускаем .git
    if (filePath.includes('.git')) return false;

    // Только текстовые расширения
    const textExtensions = [
      '.js', '.ts', '.py', '.go', '.rs', '.java', '.cpp', '.c', '.h', '.cs',
      '.php', '.rb', '.swift', '.kt', '.scala', '.m', '.mm',
      '.json', '.yaml', '.yml', '.toml', '.ini', '.env', '.xml',
      '.md', '.txt', '.rst', '.adoc', '.html', '.css', '.scss', '.less',
      '.sql', '.sh', '.bash', '.zsh', '.fish', '.bat', '.ps1',
      '.cfg', '.conf', '.config', '.properties',
    ];

    if (!textExtensions.includes(ext)) return false;

    const fileName = path.basename(filePath);
    return fileName !== 'package-lock.json' && fileName !== 'yarn.lock';
  }

  private async walkDirectory(
    dir: string,
    callback: (file: string) => Promise<void>,
  ): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await this.walkDirectory(fullPath, callback);
        }
      } else {
        await callback(fullPath);
      }
    }
  }
}