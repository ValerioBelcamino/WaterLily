import {
  createDeepSeekProvider,
  createOpenAICompatibleProvider,
  createOpenAIResponsesProvider,
} from '@waterlily/providers';

import {
  NO_FILES,
  OPENAI_FILE_CAPABILITIES,
  OPENAI_MODELS,
} from './credentials.js';
import type { AttachmentStore, RegisteredProvider } from './types.js';

type Environment = Readonly<Record<string, string | undefined>>;

function nonBlank(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value;
}

function valueOr(value: string | undefined, fallback: string): string {
  return nonBlank(value) ?? fallback;
}

export function configuredProviders(
  environment: Environment,
  attachments?: AttachmentStore,
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
      models: [
        {
          capabilities: NO_FILES,
          id: deepSeekModel,
          name: deepSeekModel,
        },
      ],
      name: 'DeepSeek',
      providerType: 'deepseek',
      source: 'environment',
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
      models: [{ capabilities: NO_FILES, id: localModel, name: localModel }],
      name: 'Local OpenAI-compatible model',
      providerType: 'openai-compatible',
      source: 'environment',
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
  const openAIKey = nonBlank(environment.OPENAI_API_KEY);
  const openAI: RegisteredProvider | null =
    openAIKey === undefined || attachments === undefined
      ? null
      : {
          descriptor: {
            available: true,
            defaultModel: 'gpt-5.6-terra',
            id: 'openai',
            models: OPENAI_MODELS.map((model) => ({
              capabilities: OPENAI_FILE_CAPABILITIES,
              contextWindowTokens: model.contextWindowTokens,
              id: model.id,
              maxOutputTokens: model.maxOutputTokens,
              name: model.name,
            })),
            name: 'OpenAI environment',
            providerType: 'openai',
            source: 'environment',
          },
          provider: createOpenAIResponsesProvider({
            apiKey: () => environment.OPENAI_API_KEY,
            attachmentLoader: (id) => Promise.resolve(attachments.get(id)),
            id: 'openai',
            name: 'OpenAI environment',
          }),
        };
  return openAI === null ? [deepSeek, local] : [openAI, deepSeek, local];
}
