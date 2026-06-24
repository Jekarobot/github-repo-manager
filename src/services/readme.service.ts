import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../core/logger';
import { DeepSeekService } from './deepseek.service';

export class ReadmeService {
  constructor(private deepseekService: DeepSeekService) {}

  async generateReadme(repoName: string, repoPath: string): Promise<boolean> {
    const readmePath = path.join(repoPath, 'README.md');

    // Проверяем, существует ли уже README
    try {
      await fs.access(readmePath);
      logger.info(`   ⏭️ ${repoName} уже имеет README.md, пропускаем`);
      return false;
    } catch {
      // README нет — генерируем
    }

    try {
      // Получаем структуру файлов для контекста
      const fileTree = await this.getFileTree(repoPath);

      // Генерируем README через DeepSeek
      const content = await this.deepseekService.generateReadme(repoName, repoPath, fileTree);

      // Сохраняем
      await fs.writeFile(readmePath, content, 'utf-8');
      logger.success(`📝 README.md сохранён для ${repoName}`);
      return true;
    } catch (error) {
      logger.error(`❌ Не удалось сгенерировать README для ${repoName}:`, error);
      throw error;
    }
  }

  private async getFileTree(repoPath: string, maxDepth: number = 2): Promise<string> {
    const lines: string[] = [];
    await this.walkDirectory(repoPath, '', 0, maxDepth, lines);
    return lines.join('\n');
  }

  private async walkDirectory(
    dirPath: string,
    prefix: string,
    depth: number,
    maxDepth: number,
    lines: string[],
  ): Promise<void> {
    if (depth > maxDepth) return;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        // Пропускаем .git, node_modules и скрытые файлы
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          lines.push(`${prefix}📁 ${entry.name}/`);
          await this.walkDirectory(fullPath, `${prefix}  `, depth + 1, maxDepth, lines);
        } else {
          lines.push(`${prefix}📄 ${entry.name}`);
        }
      }
    } catch {
      // Ошибки доступа игнорируем
    }
  }
}