export const WORKFLOW_ERROR_CODES = [
  'EMPTY_RESPONSE',
  'INCOMPLETE_RESPONSE',
  'INVALID_OPERATION',
  'UNSUPPORTED_CONTENT',
] as const;

export type WorkflowErrorCode = (typeof WORKFLOW_ERROR_CODES)[number];

export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;
  readonly details: Readonly<Record<string, number | string>>;

  constructor(
    code: WorkflowErrorCode,
    message: string,
    details: Readonly<Record<string, number | string>> = {},
  ) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
    this.details = details;
  }
}

export function failWorkflow(
  code: WorkflowErrorCode,
  message: string,
  details?: Readonly<Record<string, number | string>>,
): never {
  throw new WorkflowError(code, message, details);
}
