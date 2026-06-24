#!/usr/bin/env node

import { Command } from 'commander';
import * as dotenv from 'dotenv';
import * as fs from 'fs/promises';
import { loadConfig, validateReposConfig } from '../core/config';
import { RepositoryManager } from '../services/repository.service';
import { logger } from '../core/logger';
import { ProcessOptions } from '../core/types';

dotenv.config();

const program = new Command();

program
  .name('gh-manager')
  .description('Управление GitHub репозиториями: генерация README через DeepSeek API, обезличивание кода и пуш')
  .version('1.0.0');

program
  .command('process')
  .description('Обработать все репозитории из конфига')
  .option('-c, --config <path>', 'Путь к конфигурационному файлу', './repos.config.json')
  .option('--sanitize', 'Включить обезличивание кода (по умолчанию отключено)')
  .option('--skip-existing', 'Пропустить репозитории, в которых уже есть README.md')
  .option('--auto-push', 'Пушить изменения без подтверждения (по умолчанию — с подтверждением)')
  .option('--preview', 'Показать что будет сделано без применения изменений')
  .option('--parallel <number>', 'Количество параллельных процессов', '3')
  .action(async (options) => {
    try {
      // Проверяем API ключ
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        logger.error('❌ DEEPSEEK_API_KEY не найден в .env файле');
        logger.info('   Создайте .env файл на основе .env.example');
        process.exit(1);
      }

      // Загружаем конфиг
      const config = await loadConfig(options.config);

      // Валидация конфига
      if (config.repositories.length === 0) {
        logger.error('❌ Нет репозиториев для обработки');
        logger.info('   Добавьте репозитории в repos.config.json или через веб-интерфейс');
        process.exit(1);
      }

      const errors = validateReposConfig(config);
      if (errors.length > 0) {
        logger.error('❌ Ошибки в конфигурации:');
        errors.forEach((err) => logger.error(`   • ${err}`));
        process.exit(1);
      }

      const repoManager = new RepositoryManager(config, apiKey);

      const processOptions: ProcessOptions = {
        sanitize: options.sanitize ?? false,
        skipExisting: options.skipExisting ?? false,
        autoPush: options.autoPush ?? false,
        preview: options.preview ?? false,
        parallel: parseInt(options.parallel, 10) || 3,
      };

      if (processOptions.preview) {
        await repoManager.previewChanges();
      } else {
        await repoManager.processAll(processOptions);
      }
    } catch (error) {
      logger.error('❌ Ошибка выполнения:', error);
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Создать пример конфигурационного файла')
  .action(async () => {
    try {
      const exampleConfig = {
        workDir: './temp_repos',
        summaryFile: './PROJECTS.md',
        maxConcurrent: 3,
        repositories: [
          {
            url: 'https://github.com/username/repo1.git',
            skipIfReadmeExists: true,
            sanitize: false,
            push: false,
            branch: 'main',
          },
        ],
      };

      await fs.writeFile(
        'repos.config.example.json',
        JSON.stringify(exampleConfig, null, 2),
        'utf-8',
      );
      logger.success('Создан пример конфигурации в repos.config.example.json');
      logger.info('Скопируйте его в repos.config.json и отредактируйте под свои нужды');
    } catch (error) {
      logger.error('❌ Ошибка создания примера конфига:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);