export function createPortableId(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}
