import simpleGit, { SimpleGit } from 'simple-git';
import * as readline from 'readline';
import { logger } from '../core/logger';

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
        shouldPush = await this.confirmPush();
        if (!shouldPush) {
          logger.info('   ⏭️ Push отклонён пользователем');
          return false;
        }
      }

      // Выполняем push
      logger.info(`   📤 Push в ветку ${branch}...`);
      await git.add('.');
      await git.commit(commitMessage);
      await git.push('origin', branch, { '--force-with-lease': null });

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