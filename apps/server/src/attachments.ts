import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
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
    const normalized = safeId(id);
    const descriptor = JSON.parse(
      readFileSync(join(this.#root, `${normalized}.json`), 'utf8'),
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
    const bytes = readFileSync(join(this.#root, `${normalized}.blob`));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (bytes.byteLength !== descriptor.size || sha256 !== descriptor.sha256)
      throw new TypeError('Attachment data failed its integrity check');
    return {
      bytes,
      mediaType: descriptor.mediaType,
      name: descriptor.name,
    };
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
