import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import type { AttachmentDescriptor } from '@waterlily/api-contract';
import type { LoadedAttachment } from '@waterlily/providers';

import type { AttachmentStore } from './types.js';

const ATTACHMENT_ID = /^attachment-[0-9a-f-]{36}$/u;

function safeId(id: string): string {
  if (!ATTACHMENT_ID.test(id)) throw new TypeError('Invalid attachment id');
  return id;
}

function atomicWrite(path: string, bytes: Uint8Array | string): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, bytes, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

export class FileAttachmentStore implements AttachmentStore {
  readonly #root: string;

  public constructor(root: string) {
    this.#root = root;
    mkdirSync(root, { mode: 0o700, recursive: true });
    chmodSync(root, 0o700);
  }

  public get(id: string): LoadedAttachment {
    const record = this.read(id);
    if (record === null) throw new TypeError('Attachment does not exist');
    return {
      bytes: record.bytes,
      mediaType: record.descriptor.mediaType,
      name: record.descriptor.name,
    };
  }

  public read(id: string): {
    readonly bytes: Uint8Array;
    readonly descriptor: AttachmentDescriptor;
  } | null {
    const normalized = safeId(id);
    const metadataPath = join(this.#root, `${normalized}.json`);
    const blobPath = join(this.#root, `${normalized}.blob`);
    if (!existsSync(metadataPath) && !existsSync(blobPath)) return null;
    const descriptor = JSON.parse(
      readFileSync(metadataPath, 'utf8'),
    ) as AttachmentDescriptor;
    if (
      descriptor.id !== normalized ||
      typeof descriptor.mediaType !== 'string' ||
      typeof descriptor.name !== 'string' ||
      typeof descriptor.sha256 !== 'string' ||
      !Number.isInteger(descriptor.size) ||
      descriptor.size < 0
    )
      throw new TypeError('Attachment metadata is invalid');
    const storedBytes = readFileSync(blobPath);
    const sha256 = createHash('sha256').update(storedBytes).digest('hex');
    if (
      storedBytes.byteLength !== descriptor.size ||
      sha256 !== descriptor.sha256
    )
      throw new TypeError('Attachment data failed its integrity check');
    const bytes = new Uint8Array(storedBytes);
    return { bytes, descriptor };
  }

  public remove(id: string): boolean {
    const normalized = safeId(id);
    const paths = [
      join(this.#root, `${normalized}.json`),
      join(this.#root, `${normalized}.blob`),
    ];
    const existing = paths.filter((path) => existsSync(path));
    for (const path of existing) unlinkSync(path);
    return existing.length > 0;
  }

  public put(input: {
    readonly bytes: Uint8Array;
    readonly mediaType: string;
    readonly name: string;
  }): AttachmentDescriptor {
    const id = `attachment-${randomUUID()}`;
    const descriptor: AttachmentDescriptor = {
      id,
      mediaType: input.mediaType,
      name: input.name,
      sha256: createHash('sha256').update(input.bytes).digest('hex'),
      size: input.bytes.byteLength,
    };
    atomicWrite(join(this.#root, `${id}.blob`), input.bytes);
    atomicWrite(
      join(this.#root, `${id}.json`),
      `${JSON.stringify(descriptor)}\n`,
    );
    return descriptor;
  }
}
