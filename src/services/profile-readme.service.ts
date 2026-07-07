import * as fs from 'fs/promises';
import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { logger } from '../core/logger';
import { DeepSeekService } from './deepseek.service';
import { PushService } from './push.service';
import { GitHubService } from './github.service';
import { ReadmeService } from './readme.service';
import { ProfileCache, CachedRepo, GitHubRepo } from '../core/types';

export class ProfileReadmeService {
  private readmeService: ReadmeService;
  private pushService: PushService;
  private githubService: GitHubService;

  constructor(
    private deepseekService: DeepSeekService,
    private githubToken?: string,
  ) {
    this.readmeService = new ReadmeService(this.deepseekService);
    this.pushService = new PushService();
    this.githubService = new GitHubService(githubToken);
  }

  /**
   * Полный цикл: клонирование всех репозиториев -> анализ -> генерация README -> пуш в профильный репо
   */
  async generateProfileReadme(
    username: string,
    workDir: string,
    cachePath: string,
    profileRepoUrl: string,
    favoritesUrls: string[] = [],
  ): Promise<string> {
    // 1. Получаем список репозиториев с GitHub
    const repos = await this.githubService.fetchRepos(username);
    logger.info(`📦 Получено ${repos.length} репозиториев для ${username}`);

    // 2. Клонируем и анализируем
    const cache = await this.analyzeRepos(repos, workDir, cachePath, favoritesUrls);

    // 3. Генерируем профильный README
    const profileReadme = await this.deepseekService.generateProfileReadme(username, cache.repos);

    // 4. Пушим в профильный репозиторий
    await this.pushToProfileRepo(profileRepoUrl, profileReadme, username);

    return profileReadme;
  }

  /**
   * Только анализ репозиториев (клонирование + генерация описаний) без пуша
   */
  async analyzeRepos(
    repos: GitHubRepo[],
    workDir: string,
    cachePath: string,
    favoritesUrls: string[] = [],
  ): Promise<ProfileCache> {
    const username = this.extractUsername(repos);
    const existingCache = await this.loadCache(cachePath);
    const existingNames = new Set(existingCache.repos.map(r => r.name));

    const cachedRepos: CachedRepo[] = [];

    for (const repo of repos) {
      if (repo.fork) {
        logger.info(`   ⏭️ ${repo.name} — fork, пропускаем`);
        continue;
      }

      const isFavorite = favoritesUrls.includes(repo.clone_url);

      // Проверяем, есть ли в кэше
      if (existingNames.has(repo.name)) {
        const existing = existingCache.repos.find(r => r.name === repo.name)!;
        // Обновляем только если избранное изменилось
        cachedRepos.push({
          ...existing,
          favorite: isFavorite,
          stars: repo.stargazers_count,
        });
        logger.info(`   ⏭️ ${repo.name} — данные из кэша`);
        continue;
      }

      try {
        logger.step(`📥 Анализ ${repo.name}...`);

        // Клонируем
        const repoPath = path.join(workDir, repo.name);
        const git = simpleGit();
        if (await this.directoryExists(repoPath)) {
          await simpleGit(repoPath).pull();
        } else {
          await git.clone(repo.clone_url, repoPath, ['--depth=1']);
        }

        // Получаем структуру файлов
        const fileTree = await this.getFileTree(repoPath);

        // Генерируем описание
        let description: string;
        let detailedDescription: string;

        try {
          if (isFavorite) {
            description = await this.deepseekService.generateRepoShortDescription(repo.name, fileTree);
            detailedDescription = await this.deepseekService.generateRepoDetailedDescription(repo.name, fileTree);
          } else {
            description = await this.deepseekService.generateRepoShortDescription(repo.name, fileTree);
            detailedDescription = '';
          }
        } catch (error) {
          logger.warn(`   ⚠️ ${repo.name}: не удалось получить описание через AI (${error instanceof Error ? error.message : String(error)}), использую базовое`);
          description = repo.description || repo.name;
          detailedDescription = '';
        }

        cachedRepos.push({
          name: repo.name,
          url: repo.html_url,
          description,
          language: repo.language || 'N/A',
          stars: repo.stargazers_count,
          favorite: isFavorite,
          detailedDescription,
        });

        logger.success(`${repo.name} — описание получено`);
      } catch (error) {
        logger.warn(`   ⚠️ ${repo.name}: ошибка при анализе, использую базовую информацию`);
        cachedRepos.push({
          name: repo.name,
          url: repo.html_url,
          description: repo.description || repo.name,
          language: repo.language || 'N/A',
          stars: repo.stargazers_count,
          favorite: isFavorite,
          detailedDescription: '',
        });
      }
    }

    // Сортируем: избранные первыми, остальные по звёздам
    cachedRepos.sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return b.stars - a.stars;
    });

    const cache: ProfileCache = {
      username,
      updatedAt: new Date().toISOString(),
      repos: cachedRepos,
    };

    // Сохраняем кэш
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
    logger.success(`💾 Кэш сохранён: ${cachePath}`);

    return cache;
  }

  /**
   * Сгенерировать профильный README из кэша (без клонирования)
   */
  async generateFromCache(cachePath: string): Promise<string> {
    const cache = await this.loadCache(cachePath);
    if (cache.repos.length === 0) {
      throw new Error('Кэш пуст. Сначала выполните анализ репозиториев.');
    }

    const profileReadme = await this.deepseekService.generateProfileReadme(cache.username, cache.repos);
    return profileReadme;
  }

  /**
   * Запушить профильный README в репозиторий username/username
   */
  async pushToProfileRepo(profileRepoUrl: string, readmeContent: string, username: string): Promise<void> {
    logger.step(`📤 Пуш профильного README в ${profileRepoUrl}`);

    const repoName = profileRepoUrl.match(/\/([^/]+)\.git$/)?.[1] || username;
    const parentDir = path.dirname(profileRepoUrl);
    const cloneDir = path.join(process.cwd(), 'temp_profile_repo_' + repoName);

    try {
      // Клонируем профильный репозиторий
      const git = simpleGit();
      if (await this.directoryExists(cloneDir)) {
        await fs.rm(cloneDir, { recursive: true, force: true });
      }
      await git.clone(profileRepoUrl, cloneDir);

      // Записываем README
      const readmePath = path.join(cloneDir, 'README.md');
      await fs.writeFile(readmePath, readmeContent, 'utf-8');

      // Пушим
      const pushed = await this.pushService.pushRepository(
        cloneDir,
        'chore: update profile README [gh-manager]',
        'main',
        true, // autoPush
      );

      if (pushed) {
        logger.success(`✅ Профильный README запушен в ${profileRepoUrl}`);
      } else {
        logger.warn('⚠️ Не удалось запушить профильный README');
      }
    } catch (error) {
      logger.error(`❌ Ошибка при пуше профильного README:`, error);
      throw error;
    } finally {
      // Очищаем временную директорию
      try {
        await fs.rm(cloneDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  /**
   * Загрузить кэш из файла
   */
  async loadCache(cachePath: string): Promise<ProfileCache> {
    try {
      const content = await fs.readFile(cachePath, 'utf-8');
      return JSON.parse(content) as ProfileCache;
    } catch {
      return { username: '', updatedAt: '', repos: [] };
    }
  }

  private extractUsername(repos: GitHubRepo[]): string {
    for (const repo of repos) {
      const match = repo.html_url.match(/github\.com\/([^/]+)/);
      if (match) return match[1];
    }
    return '';
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
      // ignore
    }
  }

  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
}