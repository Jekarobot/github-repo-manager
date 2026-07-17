#!/usr/bin/env node

import { Command } from 'commander';
import * as dotenv from 'dotenv';
import * as fs from 'fs/promises';
import * as path from 'path';
import { loadConfig, validateReposConfig } from '../core/config';
import { RepositoryManager } from '../services/repository.service';
import { ProfileReadmeService } from '../services/profile-readme.service';
import { DeepSeekService } from '../services/deepseek.service';
import { GitHubService } from '../services/github.service';
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
        profileRepo: 'https://github.com/username/username.git',
        cacheFile: './profile-cache.json',
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

// ====== Команды профильного README ======

const profileCmd = program
  .command('profile-readme')
  .description('Управление профильным README (username/username)');

profileCmd
  .command('analyze')
  .description('Клонировать и проанализировать все репозитории, сохранить кэш')
  .option('-u, --username <username>', 'GitHub имя пользователя')
  .option('-c, --config <path>', 'Путь к конфигурационному файлу', './repos.config.json')
  .action(async (options) => {
    try {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        logger.error('❌ DEEPSEEK_API_KEY не найден в .env файле');
        process.exit(1);
      }

      const config = await loadConfig(options.config);
      const username = options.username || config.profileRepo?.match(/github\.com\/([^/]+)/)?.[1];
      if (!username) {
        logger.error('❌ Не указан username. Укажите --username или настройте profileRepo в конфиге.');
        process.exit(1);
      }

      const workDir = config.workDir || './temp_repos';
      const cachePath = config.cacheFile || path.resolve('profile-cache.json');
      const favoritesUrls = config.repositories
        .filter(r => r.favorite)
        .map(r => r.url);

      const github = new GitHubService(process.env.GITHUB_TOKEN);
      const deepseek = new DeepSeekService({ apiKey });
      const profileService = new ProfileReadmeService(deepseek, process.env.GITHUB_TOKEN);

      logger.info(`🚀 Анализ репозиториев для ${username}...`);
      const repos = await github.fetchRepos(username);
      const cache = await profileService.analyzeRepos(repos, workDir, cachePath, favoritesUrls);

      logger.success(`✅ Анализ завершён. Обработано ${cache.repos.length} репозиториев.`);
      logger.info(`   Кэш сохранён: ${cachePath}`);
    } catch (error) {
      logger.error('❌ Ошибка:', error);
      process.exit(1);
    }
  });

profileCmd
  .command('preview')
  .description('Сгенерировать профильный README из кэша (без пуша)')
  .option('-c, --config <path>', 'Путь к конфигурационному файлу', './repos.config.json')
  .option('-o, --output <path>', 'Сохранить в файл (опционально)')
  .action(async (options) => {
    try {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        logger.error('❌ DEEPSEEK_API_KEY не найден в .env файле');
        process.exit(1);
      }

      const config = await loadConfig(options.config);
      const cachePath = config.cacheFile || path.resolve('profile-cache.json');

      const deepseek = new DeepSeekService({ apiKey });
      const profileService = new ProfileReadmeService(deepseek, process.env.GITHUB_TOKEN);

      logger.info('📄 Генерация профильного README из кэша...');
      const readme = await profileService.generateFromCache(cachePath);
      logger.success('✅ Профильный README сгенерирован');

      if (options.output) {
        await fs.writeFile(options.output, readme, 'utf-8');
        logger.info(`   Сохранён в: ${options.output}`);
      } else {
        console.log('\n' + '='.repeat(60));
        console.log(readme);
        console.log('='.repeat(60) + '\n');
      }
    } catch (error) {
      logger.error('❌ Ошибка:', error);
      process.exit(1);
    }
  });

profileCmd
  .command('generate')
  .description('Полный цикл: анализ + генерация + пуш профильного README')
  .option('-u, --username <username>', 'GitHub имя пользователя')
  .option('-r, --repo <url>', 'URL профильного репозитория (например https://github.com/user/user.git)')
  .option('-c, --config <path>', 'Путь к конфигурационному файлу', './repos.config.json')
  .option('--telegram <value>', 'Telegram username (@user)')
  .option('--github <value>', 'GitHub username')
  .option('--hh <url>', 'URL резюме HeadHunter')
  .option('--email <value>', 'Email адрес')
  .action(async (options) => {
    try {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        logger.error('❌ DEEPSEEK_API_KEY не найден в .env файле');
        process.exit(1);
      }

      const config = await loadConfig(options.config);
      const username = options.username || config.profileRepo?.match(/github\.com\/([^/]+)/)?.[1];
      if (!username) {
        logger.error('❌ Не указан username. Укажите --username или настройте profileRepo в конфиге.');
        process.exit(1);
      }

      const profileRepo = options.repo || config.profileRepo;
      if (!profileRepo) {
        logger.error('❌ Не указан URL профильного репозитория. Укажите --repo или настройте profileRepo в конфиге.');
        process.exit(1);
      }

      const workDir = config.workDir || './temp_repos';
      const cachePath = config.cacheFile || path.resolve('profile-cache.json');
      const favoritesUrls = config.repositories
        .filter(r => r.favorite)
        .map(r => r.url);

      const deepseek = new DeepSeekService({ apiKey });
      const profileService = new ProfileReadmeService(deepseek, process.env.GITHUB_TOKEN);

      logger.info(`🚀 Полный цикл для ${username}...`);
      logger.info(`   Профильный репозиторий: ${profileRepo}`);

      const contacts = {
        telegram: options.telegram || undefined,
        github: options.github || undefined,
        hh: options.hh || undefined,
        email: options.email || undefined,
      };
      const readme = await profileService.generateProfileReadme(username, workDir, cachePath, profileRepo, favoritesUrls, undefined, contacts);

      logger.success(`✅ Профильный README сгенерирован и запушен!`);
    } catch (error) {
      logger.error('❌ Ошибка:', error);
      process.exit(1);
    }
  });

// ====== Команда избранного ======

program
  .command('favorite')
  .description('Переключить флаг избранного у репозитория')
  .argument('<repo-url>', 'URL репозитория')
  .option('-c, --config <path>', 'Путь к конфигурационному файлу', './repos.config.json')
  .action(async (repoUrl, options) => {
    try {
      const config = await loadConfig(options.config);
      const repo = config.repositories.find(r => r.url === repoUrl);

      if (!repo) {
        logger.error(`❌ Репозиторий ${repoUrl} не найден в конфиге`);
        process.exit(1);
      }

      repo.favorite = !(repo.favorite ?? false);
      await fs.writeFile(options.config, JSON.stringify(config, null, 2), 'utf-8');

      const name = repo.url.match(/\/([^/]+)\.git$/)?.[1] || repo.url;
      logger.success(`⭐ ${name}: избранное ${repo.favorite ? 'включено' : 'выключено'}`);
    } catch (error) {
      logger.error('❌ Ошибка:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);