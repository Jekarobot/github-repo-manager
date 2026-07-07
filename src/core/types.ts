export interface RepositoryConfig {
  url: string;
  skipIfReadmeExists?: boolean;
  sanitize?: boolean;
  push?: boolean;
  branch?: string;
  commitMessage?: string;
  processed?: boolean;
  enabled?: boolean;
  description?: string;
  favorite?: boolean;
}

export interface AppConfig {
  workDir: string;
  summaryFile: string;
  maxConcurrent: number;
  repositories: RepositoryConfig[];
  profileRepo?: string;
  cacheFile?: string;
  excludeUrls?: string[];
}

export interface ProcessingResult {
  repository: string;
  success: boolean;
  readmeGenerated: boolean;
  sanitized: boolean;
  pushed: boolean;
  error?: string;
  description?: string;
}

export interface DeepSeekConfig {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ProcessOptions {
  sanitize: boolean;
  skipExisting: boolean;
  autoPush: boolean;
  preview: boolean;
  parallel: number;
}

export interface GitHubRepo {
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  fork: boolean;
}

export interface CachedRepo {
  name: string;
  url: string;
  description: string;
  language: string;
  stars: number;
  favorite: boolean;
  detailedDescription: string;
}

export interface ProfileCache {
  username: string;
  updatedAt: string;
  repos: CachedRepo[];
}