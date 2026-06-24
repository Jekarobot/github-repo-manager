// src/core/types.ts
export interface Repository {
url: string;
name: string;
path?: string;
description?: string;
}

export interface SanitizationRule {
pattern: RegExp;
replacement: string;
description: string;
}

export interface RepositoryConfig {
url: string;
skipIfReadmeExists?: boolean;
sanitize?: boolean;
customRules?: SanitizationRule[];
}

export interface AppConfig {
repositories: RepositoryConfig[];
workDir: string;
deepseekApiKey: string;
summaryFile: string;
maxConcurrent: number;
skipExistingReadme: boolean;
sanitizeEnabled: boolean;
}

export interface ProcessingResult {
repository: string;
success: boolean;
readmeGenerated: boolean;
sanitized: boolean;
error?: string;
description?: string;
}
