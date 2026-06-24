export interface RepositoryConfig {
  url: string;
  skipIfReadmeExists?: boolean;
  sanitize?: boolean;
  push?: boolean;
  branch?: string;
  commitMessage?: string;
  processed?: boolean;
}

export interface AppConfig {
  workDir: string;
  summaryFile: string;
  maxConcurrent: number;
  repositories: RepositoryConfig[];
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
