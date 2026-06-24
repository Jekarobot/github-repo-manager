import * as fs from 'fs/promises';
import { logger } from '../core/logger';
import { DeepSeekService } from './deepseek.service';

export class SummaryService {
  constructor(private deepseekService: DeepSeekService) {}

  async generateSummaryFile(
    projects: Array<{ name: string; description: string; url: string }>,
    outputPath: string,
  ): Promise<void> {
    if (projects.length === 0) {
      logger.warn('Нет проектов для создания сводного файла');
      return;
    }

    logger.info(`📄 Создание сводного файла: ${outputPath}`);

    try {
      let content: string;

      // Если есть DeepSeek API ключ, генерируем через AI
      if (this.deepseekService) {
        try {
          content = await this.deepseekService.generateSummary(projects);
          content = this.formatSummary(content, projects);
        } catch {
          // Если DeepSeek недоступен, создаём простую версию локально
          logger.warn('DeepSeek недоступен, создаю простую версию сводного файла');
          content = this.generateLocalSummary(projects);
        }
      } else {
        content = this.generateLocalSummary(projects);
      }

      await fs.writeFile(outputPath, content, 'utf-8');
      logger.success(`📄 Сводный файл создан: ${outputPath}`);
    } catch (error) {
      logger.error('❌ Ошибка создания сводного файла:', error);
      throw error;
    }
  }

  private formatSummary(content: string, projects: Array<{ name: string; description: string; url: string }>): string {
    // Добавляем ссылки, если AI их не добавил
    let formatted = content;

    for (const project of projects) {
      // Если проект упоминается в тексте без ссылки, оборачиваем в ссылку
      const nameWithoutGit = project.name.replace('.git', '');
      const repoUrl = project.url.replace('.git', '');
      const linkMarkdown = `[${nameWithoutGit}](${repoUrl})`;

      const regex = new RegExp(`\\b${nameWithoutGit}\\b(?!\\s*\\()`);
      formatted = formatted.replace(regex, linkMarkdown);
    }

    return formatted;
  }

  private generateLocalSummary(projects: Array<{ name: string; description: string; url: string }>): string {
    const lines: string[] = [
      '# 📚 Мои проекты\n',
      'Список проектов на GitHub с кратким описанием.\n',
      '---\n',
    ];

    // Группируем по первому слову описания для примерной группировки
    const grouped: Record<string, typeof projects> = {};

    for (const project of projects) {
      const tech = this.detectTech(project.description);
      if (!grouped[tech]) {
        grouped[tech] = [];
      }
      grouped[tech].push(project);
    }

    for (const [group, groupProjects] of Object.entries(grouped)) {
      lines.push(`## ${group}\n`);

      for (const project of groupProjects) {
        const repoUrl = project.url.replace('.git', '');
        lines.push(`- [${project.name}](${repoUrl}) — ${project.description}`);
      }

      lines.push('');
    }

    lines.push('---\n');
    lines.push(`_Сгенерировано автоматически (${new Date().toISOString().split('T')[0]})_`);

    return lines.join('\n');
  }

  private detectTech(description: string): string {
    const techMap: Record<string, string[]> = {
      '🟦 TypeScript': ['typescript', 'ts', 'angular', 'nestjs', 'tsx'],
      '🟨 JavaScript': ['javascript', 'js', 'react', 'vue', 'node', 'npm', 'webpack'],
      '🐍 Python': ['python', 'django', 'flask', 'pandas', 'numpy', 'pytorch'],
      '☕ Java': ['java', 'spring', 'maven', 'gradle'],
      '🔵 Go': ['go', 'golang'],
      '🦀 Rust': ['rust', 'cargo', 'wasm'],
      '💎 Ruby': ['ruby', 'rails', 'gem'],
      '📱 Mobile': ['android', 'ios', 'swift', 'kotlin', 'flutter', 'react native'],
      '📊 Data Science': ['data', 'ml', 'ai', 'machine learning', 'deep learning', 'analytics'],
      '🔧 DevOps': ['docker', 'kubernetes', 'ci/cd', 'terraform', 'ansible'],
    };

    const lowerDesc = description.toLowerCase();

    for (const [group, keywords] of Object.entries(techMap)) {
      for (const keyword of keywords) {
        if (lowerDesc.includes(keyword)) {
          return group;
        }
      }
    }

    return '📦 Прочее';
  }
}