import axios from 'axios';
import { GitHubRepo } from '../core/types';

export class GitHubService {
  private readonly apiUrl = 'https://api.github.com';

  constructor(private token?: string) {}

  async fetchRepos(username: string): Promise<GitHubRepo[]> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'gh-manager',
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const repos: GitHubRepo[] = [];
    let page = 1;

    while (true) {
      const res = await axios.get<GitHubRepo[]>(
        `${this.apiUrl}/users/${encodeURIComponent(username)}/repos`,
        {
          headers,
          params: {
            per_page: 100,
            page,
            sort: 'updated',
            type: 'all',
          },
          timeout: 15000,
        },
      );

      repos.push(...res.data);

      // Проверяем, есть ли ещё страницы
      const linkHeader = res.headers.link as string | undefined;
      if (!linkHeader || !linkHeader.includes('rel="next"')) {
        break;
      }
      page++;
    }

    return repos;
  }
}