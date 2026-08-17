export const MAX_DROPPED_FILES = 8;
export const MAX_DROPPED_FILE_BYTES = 10 * 1024 * 1024;

const SUPPORTED_MEDIA_TYPES = new Set([
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
]);

const SUPPORTED_EXTENSIONS = new Set([
  'c',
  'cc',
  'conf',
  'cpp',
  'cs',
  'css',
  'csv',
  'doc',
  'docx',
  'go',
  'h',
  'hpp',
  'html',
  'java',
  'js',
  'json',
  'jsx',
  'kt',
  'log',
  'lua',
  'md',
  'mjs',
  'odt',
  'pdf',
  'php',
  'ppt',
  'pptx',
  'py',
  'rb',
  'rs',
  'rtf',
  'scss',
  'sh',
  'sql',
  'tex',
  'toml',
  'ts',
  'tsx',
  'txt',
  'xml',
  'xls',
  'xlsx',
  'yaml',
  'yml',
]);

export type DroppedFileErrorCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'NO_FILES'
  | 'TOO_MANY_FILES'
  | 'UNSUPPORTED_TYPE';

export class DroppedFileError extends Error {
  readonly code: DroppedFileErrorCode;

  constructor(code: DroppedFileErrorCode, message: string) {
    super(message);
    this.name = 'DroppedFileError';
    this.code = code;
  }
}

export interface PreparedDroppedFile {
  readonly file: File;
  readonly lastModified: number;
  readonly mediaType: string;
  readonly name: string;
  readonly size: number;
}

function extension(name: string): string {
  const separator = name.lastIndexOf('.');
  return separator === -1 ? '' : name.slice(separator + 1).toLowerCase();
}

function prepareFile(file: File): PreparedDroppedFile {
  if (file.size === 0)
    throw new DroppedFileError(
      'EMPTY_FILE',
      `${file.name} is empty and cannot be attached.`,
    );
  if (file.size > MAX_DROPPED_FILE_BYTES)
    throw new DroppedFileError(
      'FILE_TOO_LARGE',
      `${file.name} is larger than the 10 MiB attachment limit.`,
    );
  const mediaType = file.type.toLowerCase().split(';', 1)[0] as string;
  if (
    !SUPPORTED_MEDIA_TYPES.has(mediaType) &&
    !SUPPORTED_EXTENSIONS.has(extension(file.name))
  )
    throw new DroppedFileError(
      'UNSUPPORTED_TYPE',
      `${file.name} is not a supported native attachment type.`,
    );
  return {
    file,
    lastModified: file.lastModified,
    mediaType: mediaType || 'application/octet-stream',
    name: file.name,
    size: file.size,
  };
}

export async function prepareDroppedFiles(
  files: readonly File[],
): Promise<readonly PreparedDroppedFile[]> {
  if (files.length === 0)
    throw new DroppedFileError('NO_FILES', 'Drop one or more files.');
  if (files.length > MAX_DROPPED_FILES)
    throw new DroppedFileError(
      'TOO_MANY_FILES',
      `Drop no more than ${String(MAX_DROPPED_FILES)} files at once.`,
    );
  return Promise.resolve(files.map(prepareFile));
}
