import {
  createNode,
  type GraphSnapshot,
  type NodeRevision,
} from '@waterlily/domain';
import { unzipSync, zipSync, type Unzipped } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  createWaterLilyArchive,
  parseWaterLilyArchive,
  sha256Bytes,
  validateArchiveWorkspace,
  waterLilyArchiveHash,
  type ArchiveAttachment,
  type ArchiveWorkspaceV1,
} from '../src/index.js';
import { sampleGraph, time } from './helpers.js';

const ZIP_EPOCH = new Date('1980-01-01T00:00:00.000Z');

async function fixture(): Promise<{
  readonly attachment: ArchiveAttachment;
  readonly workspace: ArchiveWorkspaceV1;
}> {
  const bytes = new TextEncoder().encode('portable evidence');
  const descriptor = {
    id: 'attachment-portable',
    mediaType: 'text/plain',
    name: 'evidence.txt',
    sha256: await sha256Bytes(bytes),
    size: bytes.byteLength,
  };
  const graph = createNode(sampleGraph(), {
    blocks: [
      {
        attachmentId: descriptor.id,
        id: 'block-portable',
        mediaType: descriptor.mediaType,
        name: descriptor.name,
        type: 'attachment',
      },
    ],
    createdAt: time(9),
    kind: 'attachment',
    nodeId: 'node-portable',
    revisionId: 'revision-portable',
    title: descriptor.name,
  });
  return {
    attachment: { bytes, descriptor },
    workspace: {
      graph,
      state: {
        contextSelections: {
          'node-portable': {
            blockIds: ['block-portable'],
            mode: 'blocks',
          },
          'node-user': { mode: 'excluded' },
        },
        version: 1,
        view: {
          groups: [],
          positions: { 'node-portable': { x: 42, y: 84 } },
        },
      },
    },
  };
}

function repack(files: Unzipped): Uint8Array {
  return zipSync(files, { level: 6, mtime: ZIP_EPOCH });
}

function replaceJson(
  files: Unzipped,
  path: string,
  mutate: (value: Record<string, unknown>) => unknown,
): void {
  const bytes = files[path] as Uint8Array;
  const value = JSON.parse(new TextDecoder().decode(bytes)) as Record<
    string,
    unknown
  >;
  files[path] = new TextEncoder().encode(canonicalJson(mutate(value)));
}

function duplicateOnlyCentralDirectoryEntry(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.byteLength - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x0605_4b50) end -= 1;
  if (end < 0) throw new Error('ZIP end record not found');
  const entries = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (entries !== 1) throw new Error('Duplicate helper expects one entry');
  const central = bytes.slice(centralOffset, centralOffset + centralSize);
  const result = new Uint8Array(bytes.byteLength + central.byteLength);
  result.set(bytes.slice(0, end), 0);
  result.set(central, end);
  result.set(bytes.slice(end), end + central.byteLength);
  const resultView = new DataView(result.buffer);
  const resultEnd = end + central.byteLength;
  resultView.setUint16(resultEnd + 8, 2, true);
  resultView.setUint16(resultEnd + 10, 2, true);
  resultView.setUint32(resultEnd + 12, centralSize * 2, true);
  return result;
}

async function exportedFixture() {
  const { attachment, workspace } = await fixture();
  const exported = await createWaterLilyArchive({
    attachments: [attachment],
    exportedAt: time(20),
    exporter: { name: 'WaterLily', version: 'test' },
    workspace,
  });
  return { attachment, exported, workspace };
}

describe('WaterLily archives', () => {
  it('deterministically round-trips a complete workspace and attachment', async () => {
    const { attachment, workspace } = await fixture();
    const input = {
      attachments: [attachment],
      exportedAt: time(20),
      exporter: { name: 'WaterLily', version: '0.0.0' },
      workspace,
    };
    const first = await createWaterLilyArchive(input);
    const second = await createWaterLilyArchive(input);
    const parsed = await parseWaterLilyArchive(first.bytes);

    expect(Array.from(first.bytes)).toEqual(Array.from(second.bytes));
    expect(first.sha256).toBe(second.sha256);
    expect(await waterLilyArchiveHash(first.bytes)).toBe(first.sha256);
    expect(parsed.workspace).toEqual(workspace);
    expect(parsed.attachments).toEqual([attachment]);
    expect(parsed.manifest).toEqual(first.manifest);
    expect(parsed.manifest.attachments[0]?.path).toBe(
      `attachments/${attachment.descriptor.sha256}.blob`,
    );
  });

  it('round-trips attachment-free workspaces and full context selections', async () => {
    const graph = sampleGraph();
    const workspace: ArchiveWorkspaceV1 = {
      graph,
      state: {
        contextSelections: { 'node-user': { mode: 'full' } },
        version: 1,
        view: { groups: [], positions: {} },
      },
    };
    const exported = await createWaterLilyArchive({
      attachments: [],
      exportedAt: time(20),
      exporter: { name: 'WaterLily', version: 'test' },
      workspace,
    });
    await expect(parseWaterLilyArchive(exported.bytes)).resolves.toMatchObject({
      attachments: [],
      workspace,
    });
  });

  it('rejects corrupt workspace and attachment checksums', async () => {
    const { attachment, workspace } = await fixture();
    const exported = await createWaterLilyArchive({
      attachments: [attachment],
      exportedAt: time(20),
      exporter: { name: 'WaterLily', version: 'test' },
      workspace,
    });
    const workspaceFiles = unzipSync(exported.bytes);
    workspaceFiles['workspace.json'] = new TextEncoder().encode('{}');
    await expect(parseWaterLilyArchive(repack(workspaceFiles))).rejects.toThrow(
      expect.objectContaining({ code: 'ARCHIVE_INTEGRITY' }),
    );

    const attachmentFiles = unzipSync(exported.bytes);
    const attachmentPath = exported.manifest.attachments[0]?.path as string;
    attachmentFiles[attachmentPath] = new Uint8Array([1, 2, 3]);
    await expect(
      parseWaterLilyArchive(repack(attachmentFiles)),
    ).rejects.toThrow(expect.objectContaining({ code: 'ARCHIVE_INTEGRITY' }));
  });

  it('rejects invalid ZIPs, unsafe paths, extras, omissions, and expansion limits', async () => {
    await expect(parseWaterLilyArchive(new Uint8Array([1, 2]))).rejects.toThrow(
      'valid ZIP',
    );
    await expect(
      parseWaterLilyArchive(zipSync({ '../escape': new Uint8Array([1]) })),
    ).rejects.toThrow('unsafe path');

    const { attachment, workspace } = await fixture();
    const exported = await createWaterLilyArchive({
      attachments: [attachment],
      exportedAt: time(20),
      exporter: { name: 'WaterLily', version: 'test' },
      workspace,
    });
    const extra = unzipSync(exported.bytes);
    extra['unexpected.txt'] = new Uint8Array([1]);
    await expect(parseWaterLilyArchive(repack(extra))).rejects.toThrow(
      'unexpected files',
    );
    const missing = unzipSync(exported.bytes);
    delete missing['manifest.json'];
    await expect(parseWaterLilyArchive(repack(missing))).rejects.toThrow(
      'manifest is missing',
    );
    await expect(
      parseWaterLilyArchive(exported.bytes, { maxCompressedBytes: 1 }),
    ).rejects.toThrow(expect.objectContaining({ code: 'ARCHIVE_TOO_LARGE' }));
    await expect(
      parseWaterLilyArchive(exported.bytes, { maxExpandedBytes: 2 }),
    ).rejects.toThrow(expect.objectContaining({ code: 'ARCHIVE_TOO_LARGE' }));
    await expect(
      parseWaterLilyArchive(exported.bytes, { maxEntries: 2 }),
    ).rejects.toThrow(expect.objectContaining({ code: 'ARCHIVE_TOO_LARGE' }));
    const single = zipSync({ safe: new Uint8Array([1]) }, { level: 0 });
    await expect(
      parseWaterLilyArchive(duplicateOnlyCentralDirectoryEntry(single)),
    ).rejects.toThrow('duplicate path');
    for (const unsafe of ['/absolute', 'back\\slash', 'double//slash']) {
      await expect(
        parseWaterLilyArchive(zipSync({ [unsafe]: new Uint8Array([1]) })),
      ).rejects.toThrow('unsafe path');
    }
  });

  it('validates archive limits and workspace context state', async () => {
    const { workspace } = await fixture();
    expect(() => validateArchiveWorkspace(workspace)).not.toThrow();
    expect(() =>
      validateArchiveWorkspace({
        ...workspace,
        state: { ...workspace.state, version: 2 },
      }),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_VERSION' }));
    expect(() =>
      validateArchiveWorkspace({
        ...workspace,
        state: {
          ...workspace.state,
          contextSelections: { missing: { mode: 'full' } },
        },
      }),
    ).toThrow('missing node');
    expect(() =>
      validateArchiveWorkspace({
        ...workspace,
        state: {
          ...workspace.state,
          contextSelections: {
            'node-portable': { blockIds: ['missing'], mode: 'blocks' },
          },
        },
      }),
    ).toThrow('invalid blocks');
    await expect(
      createWaterLilyArchive(
        {
          attachments: [],
          exportedAt: time(20),
          exporter: { name: 'WaterLily', version: 'test' },
          workspace: {
            graph: sampleGraph(),
            state: {
              contextSelections: {},
              version: 1,
              view: { groups: [], positions: {} },
            },
          },
        },
        { maxEntries: 1 },
      ),
    ).rejects.toThrow('allow required files');
    expect(() => validateArchiveWorkspace(null)).toThrow('must be an object');
    expect(() =>
      validateArchiveWorkspace({ ...workspace, extra: true }),
    ).toThrow('unsupported or missing fields');
    expect(() => validateArchiveWorkspace({ ...workspace, graph: {} })).toThrow(
      'Archive graph is invalid',
    );
    expect(() =>
      validateArchiveWorkspace({ ...workspace, state: null }),
    ).toThrow('must be an object');
    expect(() =>
      validateArchiveWorkspace({
        ...workspace,
        state: { ...workspace.state, contextSelections: null },
      }),
    ).toThrow('must be an object');
    for (const selection of [
      null,
      { mode: 'unknown' },
      { extra: true, mode: 'full' },
      { blockIds: [], mode: 'blocks' },
      { blockIds: [1], mode: 'blocks' },
      { blockIds: ['block-portable', 'block-portable'], mode: 'blocks' },
    ]) {
      expect(() =>
        validateArchiveWorkspace({
          ...workspace,
          state: {
            ...workspace.state,
            contextSelections: { 'node-portable': selection },
          },
        }),
      ).toThrow();
    }
    await expect(
      createWaterLilyArchive(
        {
          attachments: [],
          exportedAt: time(20),
          exporter: { name: 'WaterLily', version: 'test' },
          workspace: {
            graph: sampleGraph(),
            state: {
              contextSelections: {},
              version: 1,
              view: { groups: [], positions: {} },
            },
          },
        },
        { maxEntries: 0 },
      ),
    ).rejects.toThrow('positive integer');
  });

  it('requires exact attachment sets, metadata, sizes, and hashes', async () => {
    const { attachment, workspace } = await fixture();
    const base = {
      exportedAt: time(20),
      exporter: { name: 'WaterLily', version: 'test' },
      workspace,
    };
    await expect(
      createWaterLilyArchive({ ...base, attachments: [] }),
    ).rejects.toThrow('exactly match');
    await expect(
      createWaterLilyArchive({
        ...base,
        attachments: [
          {
            ...attachment,
            descriptor: { ...attachment.descriptor, name: 'other.txt' },
          },
        ],
      }),
    ).rejects.toThrow('does not match the graph');
    await expect(
      createWaterLilyArchive({
        ...base,
        attachments: [
          {
            bytes: new Uint8Array([1]),
            descriptor: attachment.descriptor,
          },
        ],
      }),
    ).rejects.toThrow('size does not match');
    await expect(
      createWaterLilyArchive({
        ...base,
        attachments: [
          {
            ...attachment,
            descriptor: { ...attachment.descriptor, sha256: '0'.repeat(64) },
          },
        ],
      }),
    ).rejects.toThrow('checksum does not match');
    await expect(
      createWaterLilyArchive({
        ...base,
        attachments: [attachment, attachment],
      }),
    ).rejects.toThrow('exactly match');
    await expect(
      createWaterLilyArchive({
        ...base,
        attachments: [
          {
            ...attachment,
            descriptor: {
              ...attachment.descriptor,
              mediaType: 'application/json',
            },
          },
        ],
      }),
    ).rejects.toThrow('does not match the graph');
    await expect(
      createWaterLilyArchive(
        { ...base, attachments: [attachment, attachment] },
        { maxAttachments: 1 },
      ),
    ).rejects.toThrow('too many attachments');
    await expect(
      createWaterLilyArchive(
        { ...base, attachments: [attachment] },
        { maxEntries: 2 },
      ),
    ).rejects.toThrow('expansion limit');
    await expect(
      createWaterLilyArchive(
        { ...base, attachments: [attachment] },
        { maxCompressedBytes: 1 },
      ),
    ).rejects.toThrow('Compressed archive is too large');

    const conflictingGraph = createNode(workspace.graph, {
      blocks: [
        {
          attachmentId: attachment.descriptor.id,
          id: 'block-conflict',
          mediaType: 'application/json',
          name: attachment.descriptor.name,
          type: 'attachment',
        },
      ],
      createdAt: time(10),
      kind: 'attachment',
      nodeId: 'node-conflict',
      revisionId: 'revision-conflict',
    });
    await expect(
      createWaterLilyArchive({
        ...base,
        attachments: [attachment],
        workspace: { ...workspace, graph: conflictingGraph },
      }),
    ).rejects.toThrow('conflicting graph metadata');
  });

  it('validates descriptor primitives, timestamps, and deterministic deduplication', async () => {
    const { attachment, workspace } = await fixture();
    const base = {
      attachments: [attachment],
      exportedAt: time(20),
      exporter: { name: 'WaterLily', version: 'test' },
      workspace,
    };
    for (const descriptor of [
      null,
      { ...attachment.descriptor, extra: true },
      { ...attachment.descriptor, id: '../bad' },
      { ...attachment.descriptor, name: '' },
      { ...attachment.descriptor, sha256: 'bad' },
      { ...attachment.descriptor, size: -1 },
    ]) {
      await expect(
        createWaterLilyArchive({
          ...base,
          attachments: [{ ...attachment, descriptor } as ArchiveAttachment],
        }),
      ).rejects.toThrow();
    }
    await expect(
      createWaterLilyArchive({ ...base, exportedAt: 'not-a-date' }),
    ).rejects.toThrow('canonical');
    await expect(
      createWaterLilyArchive({
        ...base,
        exportedAt: 1 as unknown as string,
      }),
    ).rejects.toThrow('timestamp');

    const secondDescriptor = {
      ...attachment.descriptor,
      id: 'attachment-second',
    };
    const secondGraph = createNode(workspace.graph, {
      blocks: [
        {
          attachmentId: secondDescriptor.id,
          id: 'block-second',
          mediaType: secondDescriptor.mediaType,
          name: secondDescriptor.name,
          type: 'attachment',
        },
      ],
      createdAt: time(10),
      kind: 'attachment',
      nodeId: 'node-second',
      revisionId: 'revision-second',
    });
    const exported = await createWaterLilyArchive({
      ...base,
      attachments: [
        { bytes: attachment.bytes, descriptor: secondDescriptor },
        attachment,
      ],
      workspace: { ...workspace, graph: secondGraph },
    });
    expect(exported.manifest.attachments.map(({ id }) => id)).toEqual([
      'attachment-portable',
      'attachment-second',
    ]);
    expect(Object.keys(unzipSync(exported.bytes))).toHaveLength(3);
  });

  it('rejects malformed manifest fields and invalid UTF-8 JSON', async () => {
    const { exported } = await exportedFixture();
    const rejectManifest = async (
      mutate: (value: Record<string, unknown>) => unknown,
      message?: string,
      limits?: Parameters<typeof parseWaterLilyArchive>[1],
    ): Promise<void> => {
      const files = unzipSync(exported.bytes);
      replaceJson(files, 'manifest.json', mutate);
      await expect(
        parseWaterLilyArchive(repack(files), limits),
      ).rejects.toThrow(message);
    };
    await rejectManifest(() => null, 'must be an object');
    await rejectManifest((value) => ({ ...value, extra: true }), 'unsupported');
    await rejectManifest((value) => ({ ...value, exporter: null }), 'object');
    await rejectManifest((value) => ({ ...value, workspace: null }), 'object');
    await rejectManifest((value) => ({ ...value, attachments: null }), 'array');
    await rejectManifest(
      (value) => ({
        ...value,
        workspace: {
          ...(value.workspace as object),
          path: 'graph.json',
        },
      }),
      'canonical',
    );
    await rejectManifest(
      (value) => ({
        ...value,
        attachments: [
          ...(value.attachments as unknown[]),
          ...(value.attachments as unknown[]),
        ],
      }),
      'too many attachments',
      { maxAttachments: 1 },
    );
    await rejectManifest(
      (value) => ({
        ...value,
        attachments: [
          ...(value.attachments as Record<string, unknown>[]),
          ...(value.attachments as Record<string, unknown>[]),
        ],
      }),
      'ids must be unique',
    );
    await rejectManifest(
      (value) => ({
        ...value,
        attachments: (value.attachments as Record<string, unknown>[]).map(
          (entry) => ({ ...entry, path: 'attachments/wrong.blob' }),
        ),
      }),
      'path is not canonical',
    );
    await rejectManifest((value) => ({ ...value, exportedAt: 1 }), 'timestamp');
    await rejectManifest(
      (value) => ({ ...value, exportedAt: 'yesterday' }),
      'canonical',
    );
    await rejectManifest(
      (value) => ({
        ...value,
        exporter: { name: '', version: '1' },
      }),
      'non-blank',
    );
    await rejectManifest(
      (value) => ({
        ...value,
        workspace: { ...(value.workspace as object), sha256: 'bad' },
      }),
      'SHA-256',
    );
    await rejectManifest(
      (value) => ({
        ...value,
        workspace: { ...(value.workspace as object), size: -1 },
      }),
      'invalid size',
    );

    const invalidManifest = unzipSync(exported.bytes);
    invalidManifest['manifest.json'] = new Uint8Array([0xff]);
    await expect(
      parseWaterLilyArchive(repack(invalidManifest)),
    ).rejects.toThrow('not valid UTF-8 JSON');

    const invalidWorkspace = unzipSync(exported.bytes);
    const bytes = new Uint8Array([0xff]);
    invalidWorkspace['workspace.json'] = bytes;
    replaceJson(invalidWorkspace, 'manifest.json', (value) => ({
      ...value,
      workspace: {
        path: 'workspace.json',
        sha256: 'placeholder',
        size: bytes.byteLength,
      },
    }));
    const manifest = JSON.parse(
      new TextDecoder().decode(invalidWorkspace['manifest.json']),
    ) as Record<string, unknown>;
    invalidWorkspace['manifest.json'] = new TextEncoder().encode(
      canonicalJson({
        ...manifest,
        workspace: {
          ...(manifest.workspace as object),
          sha256: await sha256Bytes(bytes),
        },
      }),
    );
    await expect(
      parseWaterLilyArchive(repack(invalidWorkspace)),
    ).rejects.toThrow('not valid UTF-8 JSON');
  });

  it('rejects manifest tampering and credential-shaped workspace fields', async () => {
    const { attachment, workspace } = await fixture();
    const exported = await createWaterLilyArchive({
      attachments: [attachment],
      exportedAt: time(20),
      exporter: { name: 'WaterLily', version: 'test' },
      workspace,
    });
    const files = unzipSync(exported.bytes);
    replaceJson(files, 'manifest.json', (value) => ({
      ...value,
      schemaVersion: 2,
    }));
    await expect(parseWaterLilyArchive(repack(files))).rejects.toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_VERSION' }),
    );

    const graph: GraphSnapshot = {
      ...sampleGraph(),
      revisions: {
        ...sampleGraph().revisions,
        'revision-user': {
          ...(sampleGraph().revisions['revision-user'] as NodeRevision),
          metadata: { apiKey: 'forbidden' },
        },
      },
    };
    expect(() =>
      validateArchiveWorkspace({
        graph,
        state: {
          contextSelections: {},
          version: 1,
          view: { groups: [], positions: {} },
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'CREDENTIAL_MATERIAL' }));
  });
});
