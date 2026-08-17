import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import type {
  CreateProviderProfileRequest,
  ModelCapabilities,
  ModelDescriptor,
  ProviderDescriptor,
} from '@waterlily/api-contract';
import {
  createOpenAICompatibleProvider,
  createOpenAIResponsesProvider,
} from '@waterlily/providers';

import type {
  AttachmentStore,
  ProviderProfileStore,
  RegisteredProvider,
} from './types.js';

interface StoredProviderProfile extends CreateProviderProfileRequest {
  readonly createdAt: string;
  readonly id: string;
}

interface CredentialFileV1 {
  readonly profiles: readonly StoredProviderProfile[];
  readonly version: 1;
}

const NO_FILES: ModelCapabilities = {
  inputExtensions: [],
  inputMimeTypes: [],
  maxFileBytes: null,
  nativeFiles: false,
};

const OPENAI_FILE_CAPABILITIES: ModelCapabilities = {
  inputExtensions: [
    'c',
    'cpp',
    'cs',
    'css',
    'csv',
    'doc',
    'docx',
    'go',
    'html',
    'java',
    'js',
    'json',
    'md',
    'odt',
    'pdf',
    'php',
    'ppt',
    'pptx',
    'py',
    'rb',
    'rtf',
    'sh',
    'tex',
    'ts',
    'txt',
    'xml',
    'xls',
    'xlsx',
  ],
  inputMimeTypes: [
    'application/json',
    'application/msword',
    'application/pdf',
    'application/rtf',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/xml',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/csv',
    'text/html',
    'text/markdown',
    'text/plain',
  ],
  maxFileBytes: 10 * 1024 * 1024,
  nativeFiles: true,
};

const OPENAI_MODELS = [
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
] as const;

function modelDescriptor(
  id: string,
  capabilities: ModelCapabilities,
  name = id,
): ModelDescriptor {
  return { capabilities, id, name };
}

function validateStoredProfile(value: unknown): StoredProviderProfile {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('Stored provider profile is invalid');
  const profile = value as Partial<StoredProviderProfile>;
  if (
    typeof profile.id !== 'string' ||
    typeof profile.label !== 'string' ||
    typeof profile.createdAt !== 'string' ||
    !['deepseek', 'openai', 'openai-compatible'].includes(
      profile.providerType ?? '',
    ) ||
    (profile.apiKey !== null && typeof profile.apiKey !== 'string') ||
    (profile.baseUrl !== null && typeof profile.baseUrl !== 'string') ||
    !Array.isArray(profile.models) ||
    profile.models.some((model) => typeof model !== 'string')
  )
    throw new TypeError('Stored provider profile is invalid');
  return profile as StoredProviderProfile;
}

function readCredentialFile(path: string): CredentialFileV1 {
  if (!existsSync(path)) return { profiles: [], version: 1 };
  const value = JSON.parse(
    readFileSync(path, 'utf8'),
  ) as Partial<CredentialFileV1>;
  if (value.version !== 1 || !Array.isArray(value.profiles))
    throw new TypeError('WaterLily credential file is invalid');
  return { profiles: value.profiles.map(validateStoredProfile), version: 1 };
}

function writeCredentialFile(path: string, value: CredentialFileV1): void {
  mkdirSync(dirname(path), { mode: 0o700, recursive: true });
  chmodSync(dirname(path), 0o700);
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

export class CredentialProviderRegistry implements ProviderProfileStore {
  readonly #attachments: AttachmentStore;
  readonly #now: () => string;
  readonly #path: string;
  #profiles: StoredProviderProfile[];

  public constructor(options: {
    readonly attachments: AttachmentStore;
    readonly now?: () => string;
    readonly path: string;
  }) {
    this.#attachments = options.attachments;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#path = options.path;
    this.#profiles = [...readCredentialFile(options.path).profiles];
  }

  public create(input: CreateProviderProfileRequest): ProviderDescriptor {
    const profile: StoredProviderProfile = {
      ...structuredClone(input),
      createdAt: this.#now(),
      id: `profile-${randomUUID()}`,
    };
    this.#profiles.push(profile);
    this.#persist();
    return this.#registration(profile).descriptor;
  }

  public registrations(): readonly RegisteredProvider[] {
    return this.#profiles.map((profile) => this.#registration(profile));
  }

  public remove(id: string): boolean {
    const next = this.#profiles.filter((profile) => profile.id !== id);
    if (next.length === this.#profiles.length) return false;
    this.#profiles = next;
    this.#persist();
    return true;
  }

  #descriptor(profile: StoredProviderProfile): ProviderDescriptor {
    const models: readonly ModelDescriptor[] =
      profile.providerType === 'openai'
        ? OPENAI_MODELS.map((model) =>
            modelDescriptor(model.id, OPENAI_FILE_CAPABILITIES, model.name),
          )
        : (profile.models.length === 0
            ? ['deepseek-chat', 'deepseek-reasoner']
            : profile.models
          ).map((model) => modelDescriptor(model, NO_FILES));
    return {
      available: true,
      defaultModel:
        profile.providerType === 'openai'
          ? 'gpt-5.6-terra'
          : (models[0]?.id ?? 'unconfigured-model'),
      id: profile.id,
      models,
      name: profile.label,
      providerType: profile.providerType,
      source: 'stored',
    };
  }

  #persist(): void {
    writeCredentialFile(this.#path, {
      profiles: this.#profiles,
      version: 1,
    });
  }

  #registration(profile: StoredProviderProfile): RegisteredProvider {
    const descriptor = this.#descriptor(profile);
    if (profile.providerType === 'openai')
      return {
        descriptor,
        provider: createOpenAIResponsesProvider({
          apiKey: profile.apiKey ?? '',
          attachmentLoader: (id) => Promise.resolve(this.#attachments.get(id)),
          id: profile.id,
          name: profile.label,
        }),
      };
    const baseUrl =
      profile.providerType === 'deepseek'
        ? 'https://api.deepseek.com'
        : (profile.baseUrl as string);
    return {
      descriptor,
      provider: createOpenAICompatibleProvider({
        ...(profile.apiKey === null ? {} : { apiKey: profile.apiKey }),
        baseUrl,
        id: profile.id,
        includeUsage: true,
        name: profile.label,
      }),
    };
  }
}

export { NO_FILES, OPENAI_FILE_CAPABILITIES, OPENAI_MODELS };
