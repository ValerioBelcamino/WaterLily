export const MAX_DROPPED_FILES = 8;
export const MAX_DROPPED_FILE_BYTES = 2 * 1024 * 1024;

const TEXT_MEDIA_TYPES = new Set([
  'application/graphql',
  'application/javascript',
  'application/json',
  'application/ld+json',
  'application/sql',
  'application/toml',
  'application/typescript',
  'application/x-httpd-php',
  'application/x-javascript',
  'application/x-ndjson',
  'application/x-sh',
  'application/x-yaml',
  'application/xml',
  'application/yaml',
  'image/svg+xml',
]);

const TEXT_EXTENSIONS = new Set([
  'c',
  'cc',
  'conf',
  'cpp',
  'cs',
  'css',
  'csv',
  'go',
  'graphql',
  'h',
  'hpp',
  'html',
  'ini',
  'java',
  'js',
  'json',
  'jsonl',
  'jsx',
  'kt',
  'log',
  'lua',
  'md',
  'mjs',
  'php',
  'properties',
  'py',
  'rb',
  'rs',
  'rst',
  'scss',
  'sh',
  'sql',
  'svg',
  'tex',
  'toml',
  'ts',
  'tsx',
  'txt',
  'xml',
  'yaml',
  'yml',
]);

export type DroppedFileErrorCode =
  | 'BINARY_FILE'
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'NO_FILES'
  | 'READ_FAILED'
  | 'TOO_MANY_FILES'
  | 'UNSUPPORTED_TYPE';

export class DroppedFileError extends Error {
  readonly code: DroppedFileErrorCode;

  constructor(code: DroppedFileErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'DroppedFileError';
    this.code = code;
  }
}

export interface PreparedDroppedFile {
  readonly lastModified: number;
  readonly mediaType: string;
  readonly name: string;
  readonly size: number;
  readonly text: string;
}

function extension(name: string): string {
  const separator = name.lastIndexOf('.');
  return separator === -1 ? '' : name.slice(separator + 1).toLowerCase();
}

function isSupportedTextFile(file: File): boolean {
  const mediaType = file.type.toLowerCase().split(';', 1)[0] as string;
  return (
    mediaType.startsWith('text/') ||
    TEXT_MEDIA_TYPES.has(mediaType) ||
    (mediaType.length === 0 && TEXT_EXTENSIONS.has(extension(file.name)))
  );
}

async function prepareFile(file: File): Promise<PreparedDroppedFile> {
  if (file.size > MAX_DROPPED_FILE_BYTES) {
    throw new DroppedFileError(
      'FILE_TOO_LARGE',
      `${file.name} is larger than the 2 MiB text-file limit.`,
    );
  }
  if (!isSupportedTextFile(file)) {
    throw new DroppedFileError(
      'UNSUPPORTED_TYPE',
      `${file.name} is not a supported text file.`,
    );
  }

  let text: string;
  try {
    text = await file.text();
  } catch (cause) {
    throw new DroppedFileError(
      'READ_FAILED',
      `${file.name} could not be read.`,
      cause,
    );
  }
  const normalized = text.startsWith('\uFEFF') ? text.slice(1) : text;
  if (normalized.includes('\0')) {
    throw new DroppedFileError(
      'BINARY_FILE',
      `${file.name} appears to contain binary data.`,
    );
  }
  if (normalized.trim().length === 0) {
    throw new DroppedFileError(
      'EMPTY_FILE',
      `${file.name} does not contain readable text.`,
    );
  }

  return {
    lastModified: file.lastModified,
    mediaType: file.type || 'text/plain',
    name: file.name,
    size: file.size,
    text: normalized,
  };
}

export async function prepareDroppedFiles(
  files: readonly File[],
): Promise<readonly PreparedDroppedFile[]> {
  if (files.length === 0) {
    throw new DroppedFileError('NO_FILES', 'Drop one or more text files.');
  }
  if (files.length > MAX_DROPPED_FILES) {
    throw new DroppedFileError(
      'TOO_MANY_FILES',
      `Drop no more than ${String(MAX_DROPPED_FILES)} files at once.`,
    );
  }
  return Promise.all(files.map((file) => prepareFile(file)));
}
