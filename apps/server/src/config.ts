import {
  createDeepSeekProvider,
  createOpenAICompatibleProvider,
} from '@waterlily/providers';

import type { RegisteredProvider } from './types.js';

type Environment = Readonly<Record<string, string | undefined>>;

function nonBlank(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value;
}

function valueOr(value: string | undefined, fallback: string): string {
  return nonBlank(value) ?? fallback;
}

export function configuredProviders(
  environment: Environment,
): readonly RegisteredProvider[] {
  const deepSeekKey = nonBlank(environment.DEEPSEEK_API_KEY);
  const deepSeekBaseUrl = nonBlank(environment.DEEPSEEK_BASE_URL);
  const deepSeekModel = valueOr(
    environment.DEEPSEEK_MODEL,
    'deepseek-v4-flash',
  );
  const deepSeek: RegisteredProvider = {
    descriptor: {
      available: deepSeekKey !== undefined && deepSeekKey.length > 0,
      defaultModel: deepSeekModel,
      id: 'deepseek',
      name: 'DeepSeek',
    },
    ...(deepSeekKey === undefined || deepSeekKey.length === 0
      ? {}
      : {
          provider: createDeepSeekProvider({
            apiKey: () => environment.DEEPSEEK_API_KEY,
            ...(deepSeekBaseUrl === undefined
              ? {}
              : { baseUrl: deepSeekBaseUrl }),
          }),
        }),
  };

  const localBaseUrl = nonBlank(environment.LOCAL_LLM_BASE_URL);
  const localModel = valueOr(environment.LOCAL_LLM_MODEL, 'local-model');
  const local: RegisteredProvider = {
    descriptor: {
      available: localBaseUrl !== undefined && localBaseUrl.length > 0,
      defaultModel: localModel,
      id: 'local-openai-compatible',
      name: 'Local OpenAI-compatible model',
    },
    ...(localBaseUrl === undefined || localBaseUrl.length === 0
      ? {}
      : {
          provider: createOpenAICompatibleProvider({
            apiKey: () => environment.LOCAL_LLM_API_KEY,
            baseUrl: localBaseUrl,
            id: 'local-openai-compatible',
            includeUsage: true,
            name: 'Local OpenAI-compatible model',
          }),
        }),
  };
  return [deepSeek, local];
}
