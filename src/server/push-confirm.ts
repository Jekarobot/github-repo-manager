import { EventEmitter } from 'events';

interface ConfirmRequest {
  repoName: string;
  readmeContent: string;
  resolve: (value: boolean) => void;
}

class PushConfirmEmitter extends EventEmitter {
  private pendingRequests: ConfirmRequest[] = [];
  private currentRequest: ConfirmRequest | null = null;

  async waitForConfirmation(repoName: string, readmeContent: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const request: ConfirmRequest = {
        repoName,
        readmeContent,
        resolve,
      };

      // Если уже есть ожидающий запрос — кладём в очередь
      if (this.currentRequest) {
        this.pendingRequests.push(request);
        return;
      }

      this.currentRequest = request;
      this.emit('confirm', repoName, readmeContent);
    });
  }

  resolveCurrent(action: 'push' | 'skip'): void {
    if (!this.currentRequest) return;

    const request = this.currentRequest;
    this.currentRequest = null;

    // Если ответили 'skip' — не пушим
    request.resolve(action === 'push');

    // Если есть следующий в очереди — запускаем
    if (this.pendingRequests.length > 0) {
      const next = this.pendingRequests.shift()!;
      this.currentRequest = next;
      this.emit('confirm', next.repoName, next.readmeContent);
    }
  }
}

export const pushConfirm = new PushConfirmEmitter();