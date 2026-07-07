import * as fs from 'fs/promises';
import * as path from 'path';
import simpleGit from 'simple-git';
import * as readline from 'readline';
import { logger } from '../core/logger';
import { pushConfirm } from '../server/push-confirm';

export class PushService {
  async pushRepository(
    repoPath: string,
    commitMessage: string,
    branch: string,
    autoPush: boolean,
  ): Promise<boolean> {
    logger.step(`📤 Подготовка пуша для ${repoPath}...`);

    try {
      const git = simpleGit(repoPath);

      // Проверяем, есть ли изменения
      const status = await git.status();
      const hasChanges = status.modified.length > 0 || status.not_added.length > 0 || status.deleted.length > 0;

      if (!hasChanges) {
        logger.info('   Нет изменений для пуша');
        return false;
      }

      // Показываем diff
      logger.info('   🔍 Изменения:');
      for (const file of status.modified) logger.info(`     📝 Modified: ${file}`);
      for (const file of status.not_added) logger.info(`     ✨ New: ${file}`);
      for (const file of status.deleted) logger.info(`     🗑️ Deleted: ${file}`);

      // Если не autoPush, запрашиваем подтверждение
      let shouldPush = autoPush;
      if (!autoPush) {
        // Читаем README для предпросмотра (если есть)
        let readmeContent = '';
        try {
          const readmePath = path.join(repoPath, 'README.md');
          readmeContent = await fs.readFile(readmePath, 'utf-8');
        } catch {
          readmeContent = '(README не найден)';
        }

        if (process.stdin.isTTY) {
          // В CLI — через readline
          shouldPush = await this.confirmPush();
        } else {
          // В веб-режиме — через EventEmitter (SSE -> диалог -> ответ)
          shouldPush = await pushConfirm.waitForConfirmation(
            path.basename(repoPath),
            readmeContent,
          );
        }

        if (!shouldPush) {
          logger.info('   ⏭️ Push отклонён пользователем');
          return false;
        }
      }

      // Устанавливаем git identity перед коммитом
      const gitUserName = process.env.GIT_USER_NAME || 'gh-manager';
      const gitUserEmail = process.env.GIT_USER_EMAIL || 'gh-manager@local';
      await git.addConfig('user.name', gitUserName);
      await git.addConfig('user.email', gitUserEmail);

      // Инжектируем GITHUB_TOKEN в remote URL для аутентификации по HTTPS
      const githubToken = process.env.GITHUB_TOKEN;
      let originalUrl: string | null = null;

      if (githubToken) {
        try {
          const remotes = await git.getRemotes(true);
          const origin = remotes.find(r => r.name === 'origin');
          if (origin && origin.refs.push.startsWith('https://github.com/')) {
            originalUrl = origin.refs.push;
            const tokenUrl = originalUrl.replace(
              'https://github.com/',
              `https://x-access-token:${githubToken}@github.com/`,
            );
            await git.remote(['set-url', 'origin', tokenUrl]);
          }
        } catch {
          // Если не удалось — игнорируем
        }
      }

      // Определяем реальную ветку, если указанная не существует
      let targetBranch = branch;
      try {
        const branchSummary = await git.branch();
        const localBranches = branchSummary.all.map(b => b.trim());
        if (!localBranches.includes(targetBranch)) {
          // Пробуем master или текущую активную
          if (localBranches.includes('master')) {
            targetBranch = 'master';
          } else {
            targetBranch = branchSummary.current || targetBranch;
          }
          logger.info(`   Ветка ${branch} не найдена, использую ${targetBranch}`);
        }
      } catch {
        // Если не удалось определить — используем как есть
      }

      // Выполняем push
      logger.info(`   📤 Push в ветку ${targetBranch}...`);
      await git.add('.');
      await git.commit(commitMessage);
      await git.push('origin', targetBranch, { '--force-with-lease': null });

      // Восстанавливаем оригинальный URL (чтобы токен не светился в конфиге)
      if (originalUrl && githubToken) {
        try {
          await git.remote(['set-url', 'origin', originalUrl]);
        } catch {
          // Не критично
        }
      }

      logger.success(`✅ Push выполнен в ${branch}`);
      return true;
    } catch (error) {
      logger.error(`❌ Ошибка пуша:`, error);
      throw error;
    }
  }

  private async confirmPush(): Promise<boolean> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question('\n📤 Подтвердить push этих изменений? [y/N] ', (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
  }
}