export const DATABASE_ERROR_CODES = [
  'ALREADY_EXISTS',
  'CONFLICT',
  'CORRUPT_DATA',
  'INVALID_STATE',
  'MIGRATION_CHECKSUM_MISMATCH',
  'MIGRATION_FAILED',
  'NOT_FOUND',
  'PERSISTENCE_FAILED',
] as const;

export type DatabaseErrorCode = (typeof DATABASE_ERROR_CODES)[number];

export class DatabaseError extends Error {
  public readonly code: DatabaseErrorCode;
  public readonly details: Readonly<Record<string, unknown>>;

  public constructor(
    code: DatabaseErrorCode,
    message: string,
    options: {
      readonly cause?: unknown;
      readonly details?: Readonly<Record<string, unknown>>;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'DatabaseError';
    this.code = code;
    this.details = options.details ?? {};
  }
}

export function failDatabase(
  code: DatabaseErrorCode,
  message: string,
  options: {
    readonly cause?: unknown;
    readonly details?: Readonly<Record<string, unknown>>;
  } = {},
): never {
  throw new DatabaseError(code, message, options);
}
