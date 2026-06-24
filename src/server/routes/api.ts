import { Router, Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { loadConfig, validateReposConfig } from '../../core/config';
import { RepositoryManager } from '../../services/repository.service';
import { GitHubService } from '../../services/github.service';
import { ProcessOptions, GitHubRepo } from '../../core/types';
import { sendLog, sendEvent } from '../middleware/sse';
import { pushConfirm } from '../push-confirm';

const router = Router();

const CONFIG_PATH = process.env.CONFIG_PATH || './repos.config.json';
const ENV_PATH = path.resolve(process.cwd(), '.env');

// Атомарная запись JSON: пишем во временный файл, затем rename
let writeLock: Promise<void> = Promise.resolve();

async function safeWriteConfig(data: unknown): Promise<void> {
  const task = writeLock.then(async () => {
    const tmpPath = CONFIG_PATH + '.tmp';
    const content = JSON.stringify(data, null, 2);
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, CONFIG_PATH);
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

export default router;