import { Router, Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { loadConfig, validateReposConfig } from '../../core/config';
import { RepositoryManager } from '../../services/repository.service';
import { GitHubService } from '../../services/github.service';
import { ProfileReadmeService } from '../../services/profile-readme.service';
import { DeepSeekService } from '../../services/deepseek.service';
import { ProcessOptions, GitHubRepo, AppConfig } from '../../core/types';
import { logger } from '../../core/logger';
import { sendLog, sendEvent } from '../middleware/sse';
import { pushConfirm } from '../push-confirm';

const router = Router();

const CONFIG_PATH = process.env.CONFIG_PATH || './repos.config.json';
const ENV_PATH = path.resolve(process.cwd(), '.env');

// Очередь записи конфига (чтобы параллельные запросы не перемешивали JSON)
let writeLock: Promise<void> = Promise.resolve();

async function safeWriteConfig(data: unknown): Promise<void> {
  const task = writeLock.then(async () => {
    const content = JSON.stringify(data, null, 2) + '\n';
    await fs.writeFile(CONFIG_PATH, content, 'utf-8');
  });
  // Ошибка в одном запросе не должна блокировать следующие
  writeLock = task.catch(() => {});
  return task;
}

function mask(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return value;
  return value.substring(0, 4) + '...' + value.slice(-4);
}

// Получить конфиг
router.get('/config', async (_req: Request, res: Response) => {
  try {
    const config = await loadConfig(CONFIG_PATH);
    res.json(config);
  } catch (error) {
    res.json({
      workDir: './temp_repos',
      summaryFile: './PROJECTS.md',
      maxConcurrent: 3,
      repositories: [],
    });
  }
});

// Добавить репозиторий
router.post('/repos', async (req: Request, res: Response) => {
  try {
    const { url, skipIfReadmeExists, sanitize, push, branch } = req.body;

    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'URL обязателен' });
      return;
    }

    const config = await loadConfig(CONFIG_PATH);
    config.repositories.push({
      url,
      skipIfReadmeExists: skipIfReadmeExists ?? true,
      sanitize: sanitize ?? false,
      push: push ?? false,
      branch: branch || 'main',
    });

    await safeWriteConfig(config);
    res.json({ ok: true, repositories: config.repositories });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Удалить репозиторий по индексу
router.delete('/repos/:index', async (req: Request, res: Response) => {
  try {
    const index = parseInt(req.params.index, 10);
    const config = await loadConfig(CONFIG_PATH);

    if (index < 0 || index >= config.repositories.length) {
      res.status(404).json({ error: 'Репозиторий не найден' });
      return;
    }

    config.repositories.splice(index, 1);
    await safeWriteConfig(config);
    res.json({ ok: true, repositories: config.repositories });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Запустить обработку
router.post('/process', async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      res.status(400).json({ error: 'DEEPSEEK_API_KEY не найден в .env' });
      return;
    }

    const config = await loadConfig(CONFIG_PATH);

    if (config.repositories.length === 0) {
      res.status(400).json({ error: 'Нет репозиториев для обработки. Добавьте их во вкладке "Репозитории"' });
      return;
    }

    const errors = validateReposConfig(config);
    if (errors.length > 0) {
      res.status(400).json({ error: `Ошибки в конфиге: ${errors.join(', ')}` });
      return;
    }

    const options: ProcessOptions = {
      sanitize: req.body.sanitize ?? false,
      skipExisting: req.body.skipExisting ?? false,
      autoPush: req.body.autoPush ?? false,
      preview: false,
      parallel: req.body.parallel ?? 3,
    };

    sendEvent('start', { total: config.repositories.length, options });

    const repoManager = new RepositoryManager(config, apiKey, CONFIG_PATH);
    repoManager.processAll(options)
      .then((results) => {
        sendEvent('complete', { results: results.map(r => ({
          repository: r.repository,
          success: r.success,
          readmeGenerated: r.readmeGenerated,
          sanitized: r.sanitized,
          pushed: r.pushed,
          error: r.error,
        }))});
      })
      .catch((error) => {
        sendEvent('error', { error: String(error) });
      });

    res.json({ ok: true, message: 'Обработка запущена, следите за логами' });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Получить список репозиториев с GitHub
router.post('/fetch-repos', async (req: Request, res: Response) => {
  try {
    const { username } = req.body;
    if (!username) {
      res.status(400).json({ error: 'username обязателен' });
      return;
    }

    const token = process.env.GITHUB_TOKEN;
    const github = new GitHubService(token);
    const repos = await github.fetchRepos(username);

    res.json({
      repos: repos.map(r => ({
        name: r.name,
        full_name: r.full_name,
        clone_url: r.clone_url,
        html_url: r.html_url,
        description: r.description || '',
        language: r.language || 'Unknown',
        stars: r.stargazers_count,
        fork: r.fork,
        added: false, // будет true если уже есть в конфиге
      })),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Массово обновить список репозиториев (добавить выбранные)
router.post('/repos/batch', async (req: Request, res: Response) => {
  try {
    const { urls } = req.body;
    if (!Array.isArray(urls) || urls.length === 0) {
      res.status(400).json({ error: 'urls — непустой массив URL' });
      return;
    }

    const config = await loadConfig(CONFIG_PATH);
    const existingUrls = new Set(config.repositories.map(r => r.url));

    for (const url of urls) {
      if (!existingUrls.has(url)) {
        config.repositories.push({
          url,
          skipIfReadmeExists: true,
          sanitize: false,
          push: false,
          branch: 'main',
          enabled: true,
          processed: false,
        });
      }
    }

    await safeWriteConfig(config);
    res.json({ ok: true, added: urls.filter(u => !existingUrls.has(u)).length, repositories: config.repositories });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Сбросить флаг processed у репозитория
router.post('/repos/:index/reset', async (req: Request, res: Response) => {
  try {
    const index = parseInt(req.params.index, 10);
    const config = await loadConfig(CONFIG_PATH);

    if (index < 0 || index >= config.repositories.length) {
      res.status(404).json({ error: 'Репозиторий не найден' });
      return;
    }

    config.repositories[index].processed = false;
    await safeWriteConfig(config);
    res.json({ ok: true, repositories: config.repositories });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Переключить hidden у репозитория (скрыть из PROJECTS.md)
router.post('/repos/:index/hidden', async (req: Request, res: Response) => {
  try {
    const index = parseInt(req.params.index, 10);
    const config = await loadConfig(CONFIG_PATH);

    if (index < 0 || index >= config.repositories.length) {
      res.status(404).json({ error: 'Репозиторий не найден' });
      return;
    }

    config.repositories[index].hidden = !(config.repositories[index].hidden ?? false);
    await safeWriteConfig(config);
    res.json({ ok: true, hidden: config.repositories[index].hidden, repositories: config.repositories });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Переключить enabled у репозитория (игнорировать/не игнорировать)
router.post('/repos/:index/toggle', async (req: Request, res: Response) => {
  try {
    const index = parseInt(req.params.index, 10);
    const config = await loadConfig(CONFIG_PATH);

    if (index < 0 || index >= config.repositories.length) {
      res.status(404).json({ error: 'Репозиторий не найден' });
      return;
    }

    config.repositories[index].enabled = !(config.repositories[index].enabled ?? true);
    await safeWriteConfig(config);
    res.json({ ok: true, enabled: config.repositories[index].enabled, repositories: config.repositories });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Ответ на подтверждение пуша (из веб-диалога)
router.post('/confirm-push', (req: Request, res: Response) => {
  const { action } = req.body;
  if (action !== 'push' && action !== 'skip') {
    res.status(400).json({ error: 'action должен быть "push" или "skip"' });
    return;
  }
  pushConfirm.resolveCurrent(action);
  res.json({ ok: true });
});

// Получить настройки
router.get('/settings', async (_req: Request, res: Response) => {
  try {
    dotenv.config({ override: true });

    const deepseekKey = process.env.DEEPSEEK_API_KEY || '';
    const githubToken = process.env.GITHUB_TOKEN || '';
    const gitUserName = process.env.GIT_USER_NAME || '';
    const gitUserEmail = process.env.GIT_USER_EMAIL || '';

    res.json({
      hasDeepSeekKey: !!deepseekKey,
      hasGithubToken: !!githubToken,
      deepseekApiKey: mask(deepseekKey),
      githubToken: mask(githubToken),
      gitUserName: gitUserName || 'gh-manager',
      gitUserEmail: gitUserEmail || 'gh-manager@local',
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Сохранить настройки
router.post('/settings', async (req: Request, res: Response) => {
  try {
    const { deepseekApiKey, githubToken, gitUserName, gitUserEmail } = req.body;

    let envContent = '';
    try {
      envContent = await fs.readFile(ENV_PATH, 'utf-8');
    } catch {
      // .env не существует
    }

    const lines = envContent.split('\n');
    const result: string[] = [];
    const replaced: Record<string, boolean> = {};

    const vars: Record<string, string | undefined> = {
      DEEPSEEK_API_KEY: deepseekApiKey,
      GITHUB_TOKEN: githubToken,
      GIT_USER_NAME: gitUserName,
      GIT_USER_EMAIL: gitUserEmail,
    };

    for (const line of lines) {
      const trimmed = line.trim();
      let matched = false;
      for (const [key, value] of Object.entries(vars)) {
        if (trimmed.startsWith(`${key}=`)) {
          // Если значение пустое — оставляем то что было в файле
          if (value && value.length > 0) {
            result.push(`${key}=${value}`);
            replaced[key] = true;
          } else {
            result.push(line); // Оставляем как есть
          }
          matched = true;
          break;
        }
      }
      if (!matched) {
        result.push(line);
      }
    }

    for (const [key, value] of Object.entries(vars)) {
      if (!replaced[key] && value && value.length > 0) {
        result.push(`${key}=${value}`);
      }
    }

    await fs.writeFile(ENV_PATH, result.join('\n'), 'utf-8');

    // Обновляем process.env в runtime
    if (deepseekApiKey) process.env.DEEPSEEK_API_KEY = deepseekApiKey;
    if (githubToken) process.env.GITHUB_TOKEN = githubToken;
    if (gitUserName) process.env.GIT_USER_NAME = gitUserName;
    if (gitUserEmail) process.env.GIT_USER_EMAIL = gitUserEmail;

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ====== Избранное ======

// Переключить favorite у репозитория
router.post('/repos/:index/favorite', async (req: Request, res: Response) => {
  try {
    const index = parseInt(req.params.index, 10);
    const config = await loadConfig(CONFIG_PATH);

    if (index < 0 || index >= config.repositories.length) {
      res.status(404).json({ error: 'Репозиторий не найден' });
      return;
    }

    config.repositories[index].favorite = !(config.repositories[index].favorite ?? false);
    await safeWriteConfig(config);
    res.json({ ok: true, favorite: config.repositories[index].favorite, repositories: config.repositories });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ====== Профильный README ======

// Получить кэш профиля
router.get('/profile-readme/cache', async (_req: Request, res: Response) => {
  try {
    const config = await loadConfig(CONFIG_PATH);
    const cachePath = config.cacheFile || path.resolve('profile-cache.json');
    const apiKey = process.env.DEEPSEEK_API_KEY;

    if (!apiKey) {
      res.status(400).json({ error: 'DEEPSEEK_API_KEY не найден в .env' });
      return;
    }

    const deepseek = new DeepSeekService({ apiKey });
    const profileService = new ProfileReadmeService(deepseek, process.env.GITHUB_TOKEN);
    const cache = await profileService.loadCache(cachePath);

    res.json({ cache, username: cache.username || '' });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Только анализ репозиториев (клонирование + кэш, без пуша)
router.post('/profile-readme/analyze', async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      res.status(400).json({ error: 'DEEPSEEK_API_KEY не найден в .env' });
      return;
    }

    const { username } = req.body;
    if (!username) {
      res.status(400).json({ error: 'username обязателен' });
      return;
    }

    const config = await loadConfig(CONFIG_PATH);
    const workDir = config.workDir || './temp_repos';
    const cachePath = config.cacheFile || path.resolve('profile-cache.json');

    // Собираем URL избранных репозиториев из конфига
    const favoritesUrls = config.repositories
      .filter(r => r.favorite)
      .map(r => r.url);

    // Формируем список URL для исключения (профильный репо, excludeUrls из конфига)
    const excludeUrls: string[] = [
      ...(config.profileRepo ? [config.profileRepo] : []),
      ...(config.excludeUrls || []),
    ];

    const deepseek = new DeepSeekService({ apiKey });
    const profileService = new ProfileReadmeService(deepseek, process.env.GITHUB_TOKEN);

    // Получаем репозитории с GitHub
    const github = new GitHubService(process.env.GITHUB_TOKEN);
    const repos = await github.fetchRepos(username);

    sendEvent('profile-analyze-start', { total: repos.length });

    // Запускаем анализ (асинхронно)
    profileService.analyzeRepos(repos, workDir, cachePath, favoritesUrls, excludeUrls)
      .then((cache) => {
        sendEvent('profile-analyze-complete', { count: cache.repos.length });
      })
      .catch((error) => {
        sendEvent('error', { error: String(error) });
      });

    res.json({ ok: true, message: `Анализ ${repos.length} репозиториев запущен` });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Предпросмотр профильного README (из кэша, без пуша)
router.post('/profile-readme/preview', async (req: Request, res: Response) => {
  try {
    const config = await loadConfig(CONFIG_PATH);
    const cachePath = config.cacheFile || path.resolve('profile-cache.json');
    const previewPath = path.resolve('profile-readme-preview.md');
    const instructions = req.body.instructions || '';
    const contacts = req.body.contacts || {};

    // Загружаем кэш
    const profileService = new ProfileReadmeService(
      new DeepSeekService({ apiKey: '' }),
      process.env.GITHUB_TOKEN,
    );
    const cache = await profileService.loadCache(cachePath);

    if (cache.repos.length === 0) {
      res.status(400).json({ error: 'Кэш пуст. Сначала выполните анализ репозиториев.' });
      return;
    }

    let readme: string;
    let fromAI = false;

    // Пробуем AI-генерацию, если есть ключ
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (apiKey) {
      try {
        const deepseek = new DeepSeekService({ apiKey });
        const aiService = new ProfileReadmeService(deepseek, process.env.GITHUB_TOKEN);
        readme = await aiService.generateFromCache(cachePath, instructions, contacts);
        fromAI = true;
      } catch (error) {
        logger.warn(`Preview: AI generation failed, using local fallback. ${error instanceof Error ? error.message : String(error)}`);
        readme = generateLocalProfileReadme(cache, contacts);
      }
    } else {
      readme = generateLocalProfileReadme(cache, contacts);
    }

    // Добавляем пометку если это fallback
    if (!fromAI) {
      readme = `<!-- ⚠️ Сгенерировано локально (без AI) -->\n\n${readme}`;
    }

    // Сохраняем в файл (гарантированно)
    await fs.writeFile(previewPath, readme, 'utf-8');

    res.json({ ok: true, readme, previewFile: path.resolve(previewPath), fromAI });
  } catch (error) {
    // При любой ошибке — сохраняем хотя бы то, что есть
    try {
      const fallbackContent = `# GitHub Profile README\n\nОшибка генерации: ${error instanceof Error ? error.message : String(error)}`;
      await fs.writeFile(path.resolve('profile-readme-preview.md'), fallbackContent, 'utf-8');
    } catch {
      // Если и это не удалось — ничего не поделать
    }
    res.status(500).json({ error: String(error) });
  }
});

// Полный цикл: анализ + генерация + пуш в профильный репозиторий
router.post('/profile-readme/generate', async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      res.status(400).json({ error: 'DEEPSEEK_API_KEY не найден в .env' });
      return;
    }

    const { username, profileRepo, instructions, contacts } = req.body;
    if (!username) {
      res.status(400).json({ error: 'username обязателен' });
      return;
    }

    const config = await loadConfig(CONFIG_PATH);
    const workDir = config.workDir || './temp_repos';
    const cachePath = config.cacheFile || path.resolve('profile-cache.json');
    const repoUrl = profileRepo || config.profileRepo;

    if (!repoUrl) {
      res.status(400).json({ error: 'Не указан URL профильного репозитория. Укажите profileRepo в запросе или настройте в конфиге.' });
      return;
    }

    const favoritesUrls = config.repositories
      .filter(r => r.favorite)
      .map(r => r.url);

    const deepseek = new DeepSeekService({ apiKey });
    const profileService = new ProfileReadmeService(deepseek, process.env.GITHUB_TOKEN);

    sendEvent('profile-generate-start', { username, profileRepo: repoUrl });

    // Запускаем полный цикл (асинхронно)
    profileService.generateProfileReadme(username, workDir, cachePath, repoUrl, favoritesUrls, instructions, contacts)
      .then((readme) => {
        sendEvent('profile-generate-complete', { readme: readme.substring(0, 500) + '...' });
      })
      .catch((error) => {
        sendEvent('error', { error: String(error) });
      });

    res.json({ ok: true, message: `Генерация профильного README для ${username} запущена` });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Сохранить контакты профиля в конфиг
router.post('/profile-contacts', async (req: Request, res: Response) => {
  try {
    const contacts = req.body;
    const config = await loadConfig(CONFIG_PATH);
    config.contacts = contacts;
    await safeWriteConfig(config);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * Собирает Markdown-бейджи контактов (shields.io) для локального fallback
 */
function buildContactBadges(contacts?: Record<string, string>, username?: string): string {
  if (!contacts) return '';

  const badges: string[] = [];

  if (contacts.telegram) {
    const tg = contacts.telegram.replace(/^@/, '');
    badges.push(`<a href="https://t.me/${tg}"><img src="https://img.shields.io/badge/Telegram-${encodeURIComponent('@' + tg)}-26A5E4?logo=telegram&style=for-the-badge" alt="Telegram"></a>`);
  }

  if (contacts.github) {
    const gh = contacts.github || username || 'user';
    badges.push(`<a href="https://github.com/${gh}"><img src="https://img.shields.io/badge/GitHub-${encodeURIComponent(gh)}-181717?logo=github&style=for-the-badge" alt="GitHub"></a>`);
  }

  if (contacts.hh) {
    badges.push(`<a href="${contacts.hh}"><img src="https://img.shields.io/badge/HeadHunter-Резюме-D6001C?logo=headhunter&style=for-the-badge" alt="HeadHunter"></a>`);
  }

  if (contacts.email) {
    badges.push(`<a href="mailto:${contacts.email}"><img src="https://img.shields.io/badge/Email-${encodeURIComponent(contacts.email)}-D14836?logo=maildotru&style=for-the-badge" alt="Email"></a>`);
  }

  if (contacts.phone) {
    badges.push(`<a href="tel:${encodeURIComponent(contacts.phone)}"><img src="https://img.shields.io/badge/Phone-${encodeURIComponent(contacts.phone)}-25D366?logo=whatsapp&style=for-the-badge" alt="Phone"></a>`);
  }

  if (contacts.linkedin) {
    badges.push(`<a href="https://linkedin.com/in/${contacts.linkedin}"><img src="https://img.shields.io/badge/LinkedIn-${encodeURIComponent(contacts.linkedin)}-0A66C2?logo=linkedin&style=for-the-badge" alt="LinkedIn"></a>`);
  }

  if (contacts.website) {
    const domain = contacts.website.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    badges.push(`<a href="${contacts.website}"><img src="https://img.shields.io/badge/Website-${encodeURIComponent(domain)}-4285F4?logo=google-chrome&style=for-the-badge" alt="Website"></a>`);
  }

  if (contacts.habr) {
    badges.push(`<a href="https://habr.com/users/${contacts.habr}"><img src="https://img.shields.io/badge/Habr-${encodeURIComponent(contacts.habr)}-65A3BE?logo=habr&style=for-the-badge" alt="Habr"></a>`);
  }

  if (contacts.leetcode) {
    badges.push(`<a href="https://leetcode.com/${contacts.leetcode}"><img src="https://img.shields.io/badge/LeetCode-${encodeURIComponent(contacts.leetcode)}-FFA116?logo=leetcode&style=for-the-badge" alt="LeetCode"></a>`);
  }

  if (badges.length === 0) return '';

  return `\n<div align="center">\n  ${badges.join('\n  ')}\n</div>\n`;
}

/**
 * Локальная генерация профильного README (без AI, fallback)
 */
function generateLocalProfileReadme(
  cache: { username: string; repos: Array<{ name: string; description: string; url: string; language: string; stars: number; favorite: boolean; detailedDescription: string }> },
  contacts?: Record<string, string>,
): string {
  const lines: string[] = [];

  const username = cache.username || 'username';
  lines.push(`# 👋 Привет! Я ${username}\n`);
  lines.push('Добро пожаловать в мой GitHub профиль! Здесь собраны мои проекты.\n');
  lines.push('---\n');

  // Бейджи контактов
  const badges = buildContactBadges(contacts, username);
  if (badges) {
    lines.push(badges);
    lines.push('');
  }

  const favorites = cache.repos.filter(r => r.favorite);

  if (favorites.length > 0) {
    lines.push('## ⭐ Избранные проекты\n');
    for (const repo of favorites) {
      lines.push(`### [${repo.name}](${repo.url})`);
      if (repo.detailedDescription) {
        lines.push(`\n${repo.detailedDescription}\n`);
      } else {
        lines.push(`\n${repo.description}\n`);
      }
      lines.push(`\`${repo.language}\` ★ ${repo.stars}\n`);
    }
    lines.push('');
  }

  lines.push('---\n');
  lines.push(`_Сгенерировано автоматически (${new Date().toISOString().split('T')[0]})_`);

  return lines.join('\n');
}

export default router;
