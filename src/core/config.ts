import * as fs from 'fs/promises';
import * as path from 'path';
import { AppConfig, RepositoryConfig } from './types';

export async function loadConfig(configPath: string): Promise<AppConfig> {
  try {
    const resolvedPath = path.resolve(configPath);
    const content = await fs.readFile(resolvedPath, 'utf-8');
    const config: AppConfig = JSON.parse(content);

    // Валидация
    if (!config.repositories || !Array.isArray(config.repositories)) {
      throw new Error('Конфиг должен содержать массив repositories');
    }

    if (config.repositories.length === 0) {
      throw new Error('Список repositories не может быть пустым');
    }

    // Значения по умолчанию
    config.workDir = config.workDir || './temp_repos';
    config.summaryFile = config.summaryFile || './PROJECTS.md';
    config.maxConcurrent = config.maxConcurrent || 3;

    config.repositories = config.repositories.map((repo: RepositoryConfig) => ({
      ...repo,
      skipIfReadmeExists: repo.skipIfReadmeExists ?? true,
      sanitize: repo.sanitize ?? false,
      push: repo.push ?? false,
      branch: repo.branch || 'main',
    }));

    return config;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Ошибка парсинга JSON в ${configPath}: ${error.message}`);
    }
    throw error;
  }
}

export function validateReposConfig(config: AppConfig): string[] {
  const errors: string[] = [];

  for (let i = 0; i < config.repositories.length; i++) {
    const repo = config.repositories[i];
    if (!repo.url) {
      errors.push(`Репозиторий #${i + 1}: отсутствует url`);
    } else if (!repo.url.endsWith('.git')) {
      errors.push(`Репозиторий #${i + 1}: url должен заканчиваться на .git`);
    }
  }

  return errors;
}