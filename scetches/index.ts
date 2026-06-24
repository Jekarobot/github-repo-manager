// src/cli/index.ts
#!/usr/bin/env node

import { Command } from 'commander';
import * as dotenv from 'dotenv';
import { RepositoryManager } from '../services/repository.service';
import { ReadmeService } from '../services/readme.service';
import { SanitizerService } from '../services/sanitizer.service';
import { SummaryService } from '../services/summary.service';
import { DeepSeekService } from '../services/deepseek.service';
import { logger } from '../core/logger';
import * as fs from 'fs/promises';

dotenv.config();

const program = new Command();

program
  .name('gh-manager')
  .description('Управление GitHub репозиториями с автоматической генерацией README и обезличиванием')
  .version('1.0.0');

program
  .command('process')
  .description('Обработать все репозитории из конфига')
  .option('-c, --config <path>', 'Путь к конфигурационному файлу', './repos.config.json')
  .option('--no-sanitize', 'Отключить обезличивание')
  .option('--no-readme', 'Отключить генерацию README')
  .option('--preview', 'Только показать, что будет изменено без применения изменений')
  .option('--parallel <number>', 'Количество параллельных процессов', '3')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.config);
      
      // Инициализация сервисов
      const deepseekService = new DeepSeekService({
        apiKey: process.env.DEEPSEEK_API_KEY!,
      });
      
      const sanitizerService = new SanitizerService();
      const readmeService = new ReadmeService(deepseekService);
      const summaryService = new SummaryService(deepseekService);
      const repoManager = new RepositoryManager(
        config,
        readmeService,
        sanitizerService,
        summaryService
      );

      if (options.preview) {
        await repoManager.previewChanges();
      } else {
        await repoManager.processAll({
          sanitize: options.sanitize,
          generateReadme: options.readme,
          parallel: parseInt(options.parallel)
        });
      }
    } catch (error) {
      logger.error('❌ Ошибка выполнения:', error);
      process.exit(1);
    }
  });

program
  .command('sanitize')
  .description('Только обезличить репозитории без генерации README')
  .option('-c, --config <path>', 'Путь к конфигурационному файлу', './repos.config.json')
  .option('--preview', 'Показать что будет изменено')
  .action(async (options) => {
    // Аналогичная логика, но только для sanitize
    // ...
  });

program
  .command('init')
  .description('Создать пример конфигурационного файла')
  .action(async () => {
    const exampleConfig = {
      repositories: [
        {
          url: 'https://github.com/username/repo1.git',
          skipIfReadmeExists: true,
          sanitize: true
        }
      ],
      workDir: './temp_repos',
      summaryFile: './PROJECTS.md',
      maxConcurrent: 3,
      skipExistingReadme: true,
      sanitizeEnabled: true
    };
    
    await fs.writeFile('repos.config.example.json', JSON.stringify(exampleConfig, null, 2));
    console.log('✅ Создан пример конфигурации в repos.config.example.json');
  });

async function loadConfig(path: string) {
  try {
    const content = await fs.readFile(path, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    logger.error(`❌ Не удалось загрузить конфиг из ${path}`);
    throw error;
  }
}

program.parse();