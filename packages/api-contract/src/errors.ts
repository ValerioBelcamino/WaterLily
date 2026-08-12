export class ApiContractError extends Error {
  public constructor(
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ApiContractError';
  }
}

export function failContract(message: string): never {
  throw new ApiContractError(message);
}
