import * as fs from 'fs/promises';
import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { AppConfig, RepositoryConfig, ProcessingResult, ProcessOptions } from '../core/types';
import { logger } from '../core/logger';
import { DeepSeekService } from './deepseek.service';
import { ReadmeService } from './readme.service';
import { SanitizerService } from './sanitizer.service';
import { SummaryService } from './summary.service';
import { PushService } from './push.service';

export class RepositoryManager {
  private deepseekService: DeepSeekService;
  private readmeService: ReadmeService;
  private sanitizerService: SanitizerService;
  private summaryService: SummaryService;
  private pushService: PushService;

  constructor(
    private config: AppConfig,
    deepseekApiKey: string,
    private configPath?: string,
  ) {
    this.deepseekService = new DeepSeekService({ apiKey: deepseekApiKey });
    this.readmeService = new ReadmeService(this.deepseekService);
    this.sanitizerService = new SanitizerService();
    this.summaryService = new SummaryService(this.deepseekService);
    this.pushService = new PushService();
  }

  async processAll(options: ProcessOptions): Promise<ProcessingResult[]> {
    logger.separator();
    logger.info(`🚀 Запуск обработки ${this.config.repositories.length} репозиториев`);
    logger.info(`   WorkDir: ${this.config.workDir}`);
    logger.info(`   Параллельность: ${options.parallel}`);
    logger.info(`   Обезличивание: ${options.sanitize ? 'включено' : 'отключено'}`);
    logger.info(`   Пропуск с README: ${options.skipExisting ? 'да' : 'нет'}`);
    logger.info(`   Push: ${options.autoPush ? 'auto' : 'с подтверждением'}`);
    logger.separator();

    // Создаём рабочую директорию
    await fs.mkdir(this.config.workDir, { recursive: true });

    const results: ProcessingResult[] = [];
    const summaryData: Array<{ name: string; description: string; url: string }> = [];

    // Разбиваем на батчи для параллельной обработки
    const batches = this.chunkArray(this.config.repositories, options.parallel);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      logger.info(`\n📦 Батч ${batchIndex + 1}/${batches.length} (${batch.length} репозиториев)`);

      const batchPromises = batch.map((repo) =>
        this.processRepository(repo, options).then((result) => {
          if (result.description) {
            summaryData.push({
              name: result.repository,
              description: result.description,
              url: repo.url,
            });
          }
          return result;
        }),
      );

      const batchResults = await Promise.allSettled(batchPromises);

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            repository: 'unknown',
            success: false,
            readmeGenerated: false,
            sanitized: false,
            pushed: false,
            error: result.reason?.toString(),
          });
        }
      }
    }

    // Создаём сводный файл
    logger.separator();
    logger.step('📄 Создание сводного файла...');
    await this.summaryService.generateSummaryFile(summaryData, this.config.summaryFile);

    // Выводим итоги
    this.printResults(results);

    return results;
  }

  async previewChanges(): Promise<void> {
    logger.info('🔍 Режим предпросмотра');
    logger.info(`Будет обработано ${this.config.repositories.length} репозиториев:`);

    for (const repo of this.config.repositories) {
      const name = this.getRepoName(repo.url);
      const flags = [];
      if (repo.skipIfReadmeExists) flags.push('🔄 README (если нет)');
      if (repo.sanitize) flags.push('🧹 Обезличивание');
      if (repo.push) flags.push('📤 Push');
      logger.info(`   • ${name}${flags.length ? ` — ${flags.join(', ')}` : ''}`);
    }
  }

  private async processRepository(
    repo: RepositoryConfig,
    options: ProcessOptions,
  ): Promise<ProcessingResult> {
    const repoName = this.getRepoName(repo.url);
    const repoPath = path.join(this.config.workDir, repoName);

    const result: ProcessingResult = {
      repository: repoName,
      success: true,
      readmeGenerated: false,
      sanitized: false,
      pushed: false,
    };

    // Полностью обработанные — пропускаем
    if (repo.processed) {
      logger.info(`   ⏭️ ${repoName} уже обработан, пропускаем`);
      result.success = true;
      return result;
    }

    // Отключенные — пропускаем обработку, но добавляем в сводку
    if (repo.enabled === false) {
      logger.info(`   ⏭️ ${repoName} отключен, README не изменяется`);
      result.description = repoName;
      result.success = true;
      return result;
    }

    try {
      // 1. Клонирование
      logger.step(`📥 Клонирование ${repoName}...`);
      const git = simpleGit();
      if (await this.directoryExists(repoPath)) {
        logger.info(`   ${repoName} уже склонирован, обновляем...`);
        await simpleGit(repoPath).pull();
      } else {
        await git.clone(repo.url, repoPath, ['--depth=1']);
      }
      logger.success(`${repoName} склонирован`);

      // 2. Генерация README
      if (options.skipExisting && repo.skipIfReadmeExists) {
        const readmePath = path.join(repoPath, 'README.md');
        if (await this.fileExists(readmePath)) {
          logger.info(`   ⏭️ ${repoName} уже имеет README.md, пропускаем`);
        } else {
          result.readmeGenerated = await this.readmeService.generateReadme(repoName, repoPath);
        }
      } else {
        result.readmeGenerated = await this.readmeService.generateReadme(repoName, repoPath);
      }

      // 3. Обезличивание (опционально)
      const shouldSanitize = options.sanitize && repo.sanitize !== false;
      if (shouldSanitize) {
        result.sanitized = true;
        await this.sanitizerService.sanitizeRepository(repoPath);
      }

      // 4. Push (всегда, способ: с подтверждением или auto)
      const branch = repo.branch || 'main';
      const commitMessage = repo.commitMessage || this.buildCommitMessage(result);
      result.pushed = await this.pushService.pushRepository(
        repoPath,
        commitMessage,
        branch,
        options.autoPush,
      );

      // 5. Получаем описание для summary
      result.description = await this.getRepoDescription(repoPath, repoName);

      // 6. После успешного пуша — отмечаем репо как обработанное
      if (result.pushed) {
        await this.markProcessed(repo.url);
      }

      logger.success(`${repoName}: обработка завершена`);
    } catch (error) {
      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);
      logger.error(`❌ ${repoName}: ${result.error}`);
    }

    return result;
  }

  private getRepoName(url: string): string {
    const match = url.match(/\/([^/]+)\.git$/);
    return match ? match[1] : url;
  }

  private async getRepoDescription(repoPath: string, repoName: string): Promise<string> {
    try {
      const pkgPath = path.join(repoPath, 'package.json');
      if (await this.fileExists(pkgPath)) {
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
        if (pkg.description) return pkg.description;
      }
    } catch {
      // ignore
    }
    return repoName;
  }

  private buildCommitMessage(result: ProcessingResult): string {
    const parts: string[] = [];
    if (result.readmeGenerated) parts.push('add README.md');
    if (result.sanitized) parts.push('sanitize code');
    return `chore: ${parts.join(', ')} [gh-manager]`;
  }

  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private async markProcessed(repoUrl: string): Promise<void> {
    if (!this.configPath) return;

    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      const config = JSON.parse(content);
      const repo = config.repositories.find((r: RepositoryConfig) => r.url === repoUrl);
      if (repo) {
        repo.processed = true;
        await fs.writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
      }
    } catch {
      // Не критично
    }
  }

  private printResults(results: ProcessingResult[]): void {
    logger.separator();
    logger.result('РЕЗУЛЬТАТЫ ОБРАБОТКИ');

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);
    const readmeCount = results.filter((r) => r.readmeGenerated).length;
    const sanitizedCount = results.filter((r) => r.sanitized).length;
    const pushedCount = results.filter((r) => r.pushed).length;

    for (const result of successful) {
      const status = [];
      if (result.readmeGenerated) status.push('📄 README');
      if (result.sanitized) status.push('🧹 Sanitized');
      if (result.pushed) status.push('📤 Pushed');
      if (status.length === 0) status.push('✅ Ok');
      logger.info(`   • ${result.repository}: ${status.join(', ')}`);
    }

    for (const result of failed) {
      logger.error(`   • ${result.repository}: ${result.error}`);
    }

    logger.separator();
    logger.result(
      `✅ Успешно: ${successful.length}/${results.length} | ` +
        `README: ${readmeCount} | ` +
        `Обезличено: ${sanitizedCount} | ` +
        `Pushed: ${pushedCount}`,
    );
  }
}