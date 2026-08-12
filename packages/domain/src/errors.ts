export const GRAPH_ERROR_CODES = [
  'CAUSAL_CYCLE',
  'DUPLICATE_EDGE',
  'DUPLICATE_ID',
  'DUPLICATE_SLOT',
  'INVALID_CONTENT',
  'INVALID_EDGE',
  'INVALID_GRAPH',
  'INVALID_ID',
  'INVALID_NODE',
  'INVALID_REVISION',
  'INVALID_TIMESTAMP',
  'NODE_DELETED',
  'NOT_FOUND',
  'SELF_EDGE',
] as const;

export type GraphErrorCode = (typeof GRAPH_ERROR_CODES)[number];

export class GraphDomainError extends Error {
  public readonly code: GraphErrorCode;
  public readonly details: Readonly<Record<string, unknown>>;

  public constructor(
    code: GraphErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'GraphDomainError';
    this.code = code;
    this.details = details;
  }
}

export function fail(
  code: GraphErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new GraphDomainError(code, message, details);
}
