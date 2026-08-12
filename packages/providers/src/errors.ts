export const PROVIDER_ERROR_CODES = [
  'CANCELED',
  'CONFIGURATION_ERROR',
  'HTTP_ERROR',
  'INVALID_REQUEST',
  'NETWORK_ERROR',
  'PROTOCOL_ERROR',
] as const;

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly providerId: string;
  readonly status: number | null;

  constructor(
    code: ProviderErrorCode,
    message: string,
    options: {
      readonly cause?: unknown;
      readonly providerId: string;
      readonly status?: number;
    },
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'ProviderError';
    this.code = code;
    this.providerId = options.providerId;
    this.status = options.status ?? null;
  }
}
