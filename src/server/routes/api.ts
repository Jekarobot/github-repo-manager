import { Router, Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { loadConfig, validateReposConfig } from '../../core/config';
import { RepositoryManager } from '../../services/repository.service';
import { ProcessOptions } from '../../core/types';
import { sendLog, sendEvent } from '../middleware/sse';

const router = Router();

const CONFIG_PATH = process.env.CONFIG_PATH || './repos.config.json';

// Получить конфиг
router.get('/config', async (_req: Request, res: Response) => {
  try {
    const config = await loadConfig(CONFIG_PATH);
    res.json(config);
  } catch (error) {
    // Если конфига нет, возвращаем пустой шаблон
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

    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
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
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
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

    const errors = validateReposConfig(config);
    if (errors.length > 0) {
      res.status(400).json({ error: `Ошибки в конфиге: ${errors.join(', ')}` });
      return;
    }

    const options: ProcessOptions = {
      sanitize: req.body.sanitize ?? false,
      skipExisting: req.body.skipExisting ?? false,
      push: req.body.push ?? false,
      autoPush: req.body.autoPush ?? false,
      preview: false,
      parallel: req.body.parallel ?? 3,
    };

    sendEvent('start', { total: config.repositories.length, options });

    // Перехватываем console.log для отправки в SSE
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args: unknown[]) => {
      sendLog(args.map(String).join(' '));
      originalLog(...args);
    };
    console.warn = (...args: unknown[]) => {
      sendLog(`⚠️ ${args.map(String).join(' ')}`);
      originalWarn(...args);
    };
    console.error = (...args: unknown[]) => {
      sendLog(`❌ ${args.map(String).join(' ')}`);
      originalError(...args);
    };

    // Запускаем асинхронно
    const repoManager = new RepositoryManager(config, apiKey);
    repoManager.processAll(options)
      .then((results) => {
        // Восстанавливаем оригинальный консоль
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;

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
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;

        sendEvent('error', { error: String(error) });
      });

    res.json({ ok: true, message: 'Обработка запущена, следите за логами' });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;