export const CONTEXT_ERROR_CODES = [
  'DUPLICATE_HEAD_SLOT',
  'DUPLICATE_OVERRIDE',
  'INVALID_BLOCK_SELECTION',
  'INVALID_ESTIMATE',
  'INVALID_HEAD',
  'INVALID_OVERRIDE',
  'INVALID_TOKEN_BUDGET',
  'NOT_FOUND',
] as const;

export type ContextErrorCode = (typeof CONTEXT_ERROR_CODES)[number];

export class ContextCompilerError extends Error {
  public readonly code: ContextErrorCode;
  public readonly details: Readonly<Record<string, unknown>>;

  public constructor(
    code: ContextErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'ContextCompilerError';
    this.code = code;
    this.details = details;
  }
}

export function failContext(
  code: ContextErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new ContextCompilerError(code, message, details);
}
