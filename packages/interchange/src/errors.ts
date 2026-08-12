export const INTERCHANGE_ERROR_CODES = [
  'ATTACHMENTS_REQUIRE_ARCHIVE',
  'CREDENTIAL_MATERIAL',
  'DOCUMENT_TOO_LARGE',
  'ID_COLLISION',
  'INVALID_DOCUMENT',
  'UNSUPPORTED_VERSION',
] as const;

export type InterchangeErrorCode = (typeof INTERCHANGE_ERROR_CODES)[number];

export class InterchangeError extends Error {
  readonly code: InterchangeErrorCode;
  readonly details: Readonly<Record<string, number | string>>;

  constructor(
    code: InterchangeErrorCode,
    message: string,
    details: Readonly<Record<string, number | string>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'InterchangeError';
    this.code = code;
    this.details = details;
  }
}

export function failInterchange(
  code: InterchangeErrorCode,
  message: string,
  details?: Readonly<Record<string, number | string>>,
): never {
  throw new InterchangeError(code, message, details);
}
