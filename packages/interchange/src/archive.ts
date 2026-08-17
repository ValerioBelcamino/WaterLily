import { unzip, zip, type Unzipped, type Zippable } from 'fflate';

import {
  validateGraph,
  type AttachmentContentBlock,
  type GraphSnapshot,
  type NodeRevision,
} from '@waterlily/domain';

import { canonicalJson, sha256Bytes } from './canonical.js';
import { failInterchange, InterchangeError } from './errors.js';
import { validateGraphViewState } from './document.js';
import type {
  ArchiveAttachment,
  ArchiveAttachmentDescriptor,
  ArchiveContextSelection,
  ArchiveWorkspaceV1,
  CreateWaterLilyArchiveInput,
  ExportedWaterLilyArchive,
  ParsedWaterLilyArchive,
  WaterLilyArchiveLimits,
  WaterLilyArchiveManifestV1,
} from './types.js';

const FORMAT = 'waterlily/archive';
const WORKSPACE_PATH = 'workspace.json';
const MANIFEST_PATH = 'manifest.json';
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const FORBIDDEN_METADATA_KEYS = new Set([
  'accesskey',
  'apikey',
  'authorization',
  'credential',
  'credentials',
  'password',
  'secret',
]);
const DEFAULT_LIMITS = {
  maxAttachmentBytes: 10 * 1024 * 1024,
  maxAttachments: 64,
  maxCompressedBytes: 128 * 1024 * 1024,
  maxEntries: 66,
  maxExpandedBytes: 256 * 1024 * 1024,
} as const;
const ZIP_EPOCH = new Date('1980-01-01T00:00:00.000Z');

type ResolvedLimits = Required<WaterLilyArchiveLimits>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value))
    failInterchange('INVALID_DOCUMENT', `${label} must be an object`);
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (
    actual.length !== sorted.length ||
    actual.some((key, index) => key !== sorted[index])
  )
    failInterchange(
      'INVALID_DOCUMENT',
      `${label} has unsupported or missing fields`,
    );
}

function nonBlank(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    failInterchange('INVALID_DOCUMENT', `${label} must be a non-blank string`);
  return value;
}

function portableId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value))
    failInterchange('INVALID_DOCUMENT', `${label} must be a portable id`);
  return value;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value))
    failInterchange('INVALID_DOCUMENT', `${label} must be a SHA-256 hash`);
  return value;
}

function boundedSize(value: unknown, maximum: number, label: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > maximum
  )
    failInterchange('ARCHIVE_TOO_LARGE', `${label} has an invalid size`, {
      maximum,
    });
  return value as number;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string')
    failInterchange('INVALID_DOCUMENT', `${label} must be a timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value)
    failInterchange('INVALID_DOCUMENT', `${label} must be canonical`);
  return value;
}

function limits(value: WaterLilyArchiveLimits = {}): ResolvedLimits {
  const resolved: ResolvedLimits = { ...DEFAULT_LIMITS, ...value };
  for (const [name, limit] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(limit) || limit <= 0)
      failInterchange(
        'INVALID_DOCUMENT',
        `Archive limit ${name} must be a positive integer`,
      );
  }
  if (resolved.maxEntries < 2 || resolved.maxExpandedBytes < 2)
    failInterchange(
      'INVALID_DOCUMENT',
      'Archive limits must allow required files',
    );
  return resolved;
}

function assertNoCredentials(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoCredentials(item, `${path}[${String(index)}]`),
    );
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll(/[^a-z]/gu, '');
    if (FORBIDDEN_METADATA_KEYS.has(normalized))
      failInterchange(
        'CREDENTIAL_MATERIAL',
        'WaterLily archives cannot contain credential-shaped fields',
        { path: `${path}.${key}` },
      );
    assertNoCredentials(item, `${path}.${key}`);
  }
}

function contextSelection(
  nodeId: string,
  revision: NodeRevision,
  value: unknown,
): ArchiveContextSelection {
  const item = record(value, `context selection ${nodeId}`);
  if (item.mode === 'full' || item.mode === 'excluded') {
    exactKeys(item, ['mode'], `context selection ${nodeId}`);
    return { mode: item.mode };
  }
  if (item.mode !== 'blocks' || !Array.isArray(item.blockIds))
    failInterchange(
      'INVALID_DOCUMENT',
      `context selection ${nodeId} is invalid`,
    );
  exactKeys(item, ['blockIds', 'mode'], `context selection ${nodeId}`);
  const blockIds = item.blockIds.filter(
    (blockId): blockId is string => typeof blockId === 'string',
  );
  const validIds = new Set(revision.blocks.map((block) => block.id));
  if (
    blockIds.length === 0 ||
    blockIds.length !== item.blockIds.length ||
    new Set(blockIds).size !== blockIds.length ||
    blockIds.some((blockId) => !validIds.has(blockId))
  )
    failInterchange(
      'INVALID_DOCUMENT',
      `context selection ${nodeId} references invalid blocks`,
    );
  return { blockIds, mode: 'blocks' };
}

export function validateArchiveWorkspace(value: unknown): ArchiveWorkspaceV1 {
  const workspace = record(value, 'archive workspace');
  exactKeys(workspace, ['graph', 'state'], 'archive workspace');
  const graph = workspace.graph as GraphSnapshot;
  try {
    validateGraph(graph);
  } catch (cause) {
    throw new InterchangeError(
      'INVALID_DOCUMENT',
      'Archive graph is invalid',
      {},
      { cause },
    );
  }
  const state = record(workspace.state, 'archive workspace state');
  exactKeys(
    state,
    ['contextSelections', 'version', 'view'],
    'archive workspace state',
  );
  if (state.version !== 1)
    failInterchange(
      'UNSUPPORTED_VERSION',
      'Workspace state version is unsupported',
    );
  const rawSelections = record(
    state.contextSelections,
    'archive context selections',
  );
  const contextSelections: Record<string, ArchiveContextSelection> = {};
  for (const [nodeId, selection] of Object.entries(rawSelections)) {
    const node = graph.nodes[nodeId];
    if (node === undefined)
      failInterchange(
        'INVALID_DOCUMENT',
        'Archive context selection references a missing node',
      );
    const revision = graph.revisions[node.currentRevisionId] as NodeRevision;
    contextSelections[nodeId] = contextSelection(nodeId, revision, selection);
  }
  const normalized: ArchiveWorkspaceV1 = {
    graph,
    state: {
      contextSelections,
      version: 1,
      view: validateGraphViewState(graph, state.view),
    },
  };
  assertNoCredentials(normalized);
  return structuredClone(normalized);
}

function referencedAttachments(
  graph: GraphSnapshot,
): ReadonlyMap<string, AttachmentContentBlock> {
  const references = new Map<string, AttachmentContentBlock>();
  for (const revision of Object.values(graph.revisions)) {
    for (const block of revision.blocks) {
      if (block.type !== 'attachment') continue;
      const existing = references.get(block.attachmentId);
      if (
        existing !== undefined &&
        (existing.mediaType !== block.mediaType || existing.name !== block.name)
      )
        failInterchange(
          'INVALID_DOCUMENT',
          'One attachment id has conflicting graph metadata',
          { attachmentId: block.attachmentId },
        );
      references.set(block.attachmentId, block);
    }
  }
  return references;
}

function attachmentPath(sha: string): string {
  return `attachments/${sha}.blob`;
}

function descriptor(
  value: unknown,
  maximumBytes: number,
  withPath: boolean,
): ArchiveAttachmentDescriptor & { readonly path?: string } {
  const item = record(value, 'archive attachment');
  exactKeys(
    item,
    withPath
      ? ['id', 'mediaType', 'name', 'path', 'sha256', 'size']
      : ['id', 'mediaType', 'name', 'sha256', 'size'],
    'archive attachment',
  );
  const sha = hash(item.sha256, 'attachment sha256');
  const normalized = {
    id: portableId(item.id, 'attachment id'),
    mediaType: nonBlank(item.mediaType, 'attachment mediaType'),
    name: nonBlank(item.name, 'attachment name'),
    sha256: sha,
    size: boundedSize(item.size, maximumBytes, 'attachment'),
  };
  if (withPath && item.path !== attachmentPath(sha))
    failInterchange('INVALID_DOCUMENT', 'Attachment path is not canonical');
  return withPath ? { ...normalized, path: item.path as string } : normalized;
}

function manifest(
  value: unknown,
  resolved: ResolvedLimits,
): WaterLilyArchiveManifestV1 {
  const item = record(value, 'archive manifest');
  exactKeys(
    item,
    [
      'attachments',
      'exportedAt',
      'exporter',
      'format',
      'schemaVersion',
      'workspace',
    ],
    'archive manifest',
  );
  if (item.format !== FORMAT || item.schemaVersion !== 1)
    failInterchange(
      'UNSUPPORTED_VERSION',
      'WaterLily archive version is unsupported',
    );
  const exporter = record(item.exporter, 'archive exporter');
  exactKeys(exporter, ['name', 'version'], 'archive exporter');
  const workspace = record(item.workspace, 'archive workspace entry');
  exactKeys(workspace, ['path', 'sha256', 'size'], 'archive workspace entry');
  if (workspace.path !== WORKSPACE_PATH)
    failInterchange('INVALID_DOCUMENT', 'Workspace path is not canonical');
  if (!Array.isArray(item.attachments))
    failInterchange('INVALID_DOCUMENT', 'Archive attachments must be an array');
  if (item.attachments.length > resolved.maxAttachments)
    failInterchange('ARCHIVE_TOO_LARGE', 'Archive has too many attachments');
  const attachments = item.attachments.map((entry) =>
    descriptor(entry, resolved.maxAttachmentBytes, true),
  ) as WaterLilyArchiveManifestV1['attachments'];
  const ids = attachments.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length)
    failInterchange(
      'INVALID_DOCUMENT',
      'Archive attachment ids must be unique',
    );
  const normalized: WaterLilyArchiveManifestV1 = {
    attachments,
    exportedAt: timestamp(item.exportedAt, 'archive exportedAt'),
    exporter: {
      name: nonBlank(exporter.name, 'exporter name'),
      version: nonBlank(exporter.version, 'exporter version'),
    },
    format: FORMAT,
    schemaVersion: 1,
    workspace: {
      path: WORKSPACE_PATH,
      sha256: hash(workspace.sha256, 'workspace sha256'),
      size: boundedSize(workspace.size, resolved.maxExpandedBytes, 'workspace'),
    },
  };
  assertNoCredentials(normalized);
  return normalized;
}

function assertAttachmentSet(
  workspace: ArchiveWorkspaceV1,
  attachments: readonly ArchiveAttachment[],
): void {
  const references = referencedAttachments(workspace.graph);
  const supplied = new Map(
    attachments.map((attachment) => [attachment.descriptor.id, attachment]),
  );
  if (
    supplied.size !== attachments.length ||
    supplied.size !== references.size ||
    [...references.keys()].some((id) => !supplied.has(id))
  )
    failInterchange(
      'INVALID_DOCUMENT',
      'Archive attachments must exactly match graph references',
    );
  for (const [id, reference] of references) {
    const item = supplied.get(id) as ArchiveAttachment;
    if (
      item.descriptor.mediaType !== reference.mediaType ||
      (reference.name !== null && item.descriptor.name !== reference.name)
    )
      failInterchange(
        'INVALID_DOCUMENT',
        'Archive attachment metadata does not match the graph',
        { attachmentId: id },
      );
  }
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}

function decodeJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new InterchangeError(
      'INVALID_DOCUMENT',
      `${label} is not valid UTF-8 JSON`,
      {},
      { cause },
    );
  }
}

function zipFiles(files: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6, mtime: ZIP_EPOCH }, (error, data) => {
      /* v8 ignore next -- fflate reports only environment/internal failures here */
      if (error !== null) reject(error);
      else resolve(data);
    });
  });
}

export async function createWaterLilyArchive(
  input: CreateWaterLilyArchiveInput,
  configuredLimits: WaterLilyArchiveLimits = {},
): Promise<ExportedWaterLilyArchive> {
  const resolved = limits(configuredLimits);
  const workspace = validateArchiveWorkspace(input.workspace);
  if (input.attachments.length > resolved.maxAttachments)
    failInterchange('ARCHIVE_TOO_LARGE', 'Archive has too many attachments');
  const attachments: ArchiveAttachment[] = [];
  for (const attachment of input.attachments) {
    const normalized = descriptor(
      attachment.descriptor,
      resolved.maxAttachmentBytes,
      false,
    ) as ArchiveAttachmentDescriptor;
    if (attachment.bytes.byteLength !== normalized.size)
      failInterchange(
        'ARCHIVE_INTEGRITY',
        'Attachment size does not match its descriptor',
        { attachmentId: normalized.id },
      );
    if ((await sha256Bytes(attachment.bytes)) !== normalized.sha256)
      failInterchange(
        'ARCHIVE_INTEGRITY',
        'Attachment checksum does not match its descriptor',
        { attachmentId: normalized.id },
      );
    attachments.push({ bytes: attachment.bytes, descriptor: normalized });
  }
  assertAttachmentSet(workspace, attachments);
  const workspaceBytes = encodeJson(workspace);
  boundedSize(
    workspaceBytes.byteLength,
    resolved.maxExpandedBytes,
    'workspace',
  );
  const entries = attachments
    .map(({ descriptor: item }) => ({
      ...item,
      path: attachmentPath(item.sha256),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const archiveManifest: WaterLilyArchiveManifestV1 = {
    attachments: entries,
    exportedAt: timestamp(input.exportedAt, 'archive exportedAt'),
    exporter: {
      name: nonBlank(input.exporter.name, 'exporter name'),
      version: nonBlank(input.exporter.version, 'exporter version'),
    },
    format: FORMAT,
    schemaVersion: 1,
    workspace: {
      path: WORKSPACE_PATH,
      sha256: await sha256Bytes(workspaceBytes),
      size: workspaceBytes.byteLength,
    },
  };
  assertNoCredentials(archiveManifest);
  const files: Record<string, Uint8Array> = {
    [MANIFEST_PATH]: encodeJson(archiveManifest),
    [WORKSPACE_PATH]: workspaceBytes,
  };
  for (const attachment of attachments) {
    const path = attachmentPath(attachment.descriptor.sha256);
    files[path] ??= attachment.bytes;
  }
  const expandedBytes = Object.values(files).reduce(
    (total, file) => total + file.byteLength,
    0,
  );
  if (
    Object.keys(files).length > resolved.maxEntries ||
    expandedBytes > resolved.maxExpandedBytes
  )
    failInterchange('ARCHIVE_TOO_LARGE', 'Archive expansion limit exceeded');
  const bytes = await zipFiles(files);
  if (bytes.byteLength > resolved.maxCompressedBytes)
    failInterchange('ARCHIVE_TOO_LARGE', 'Compressed archive is too large');
  return {
    bytes,
    manifest: archiveManifest,
    sha256: await sha256Bytes(bytes),
  };
}

function safePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 255 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    path
      .split('/')
      .every((part) => part.length > 0 && part !== '.' && part !== '..')
  );
}

function unzipFiles(
  bytes: Uint8Array,
  resolved: ResolvedLimits,
): Promise<Unzipped> {
  if (bytes.byteLength > resolved.maxCompressedBytes)
    failInterchange('ARCHIVE_TOO_LARGE', 'Compressed archive is too large');
  return new Promise((resolve, reject) => {
    let expandedBytes = 0;
    const paths = new Set<string>();
    try {
      unzip(
        bytes,
        {
          filter: (file) => {
            if (!safePath(file.name))
              failInterchange(
                'INVALID_DOCUMENT',
                'Archive contains an unsafe path',
              );
            if (paths.has(file.name))
              failInterchange(
                'INVALID_DOCUMENT',
                'Archive contains a duplicate path',
              );
            paths.add(file.name);
            expandedBytes += file.originalSize;
            if (
              paths.size > resolved.maxEntries ||
              expandedBytes > resolved.maxExpandedBytes
            )
              failInterchange(
                'ARCHIVE_TOO_LARGE',
                'Archive expansion limit exceeded',
              );
            return true;
          },
        },
        (error, data) => {
          if (error !== null) reject(error);
          else resolve(data);
        },
      );
    } catch (cause) {
      reject(
        cause instanceof Error
          ? cause
          : /* v8 ignore next -- JavaScript and fflate throw Error instances */
            new Error('Archive extraction failed', { cause }),
      );
    }
  });
}

export async function parseWaterLilyArchive(
  bytes: Uint8Array,
  configuredLimits: WaterLilyArchiveLimits = {},
): Promise<ParsedWaterLilyArchive> {
  const resolved = limits(configuredLimits);
  let files: Unzipped;
  try {
    files = await unzipFiles(bytes, resolved);
  } catch (cause) {
    if (cause instanceof InterchangeError) throw cause;
    throw new InterchangeError(
      'INVALID_DOCUMENT',
      'WaterLily archive is not a valid ZIP file',
      {},
      { cause },
    );
  }
  const manifestBytes = files[MANIFEST_PATH];
  if (manifestBytes === undefined)
    failInterchange('INVALID_DOCUMENT', 'Archive manifest is missing');
  const parsedManifest = manifest(
    decodeJson(manifestBytes, 'Archive manifest'),
    resolved,
  );
  const expectedPaths = new Set([
    MANIFEST_PATH,
    WORKSPACE_PATH,
    ...parsedManifest.attachments.map((attachment) => attachment.path),
  ]);
  if (
    Object.keys(files).length !== expectedPaths.size ||
    Object.keys(files).some((path) => !expectedPaths.has(path))
  )
    failInterchange(
      'INVALID_DOCUMENT',
      'Archive contains missing or unexpected files',
    );
  const workspaceBytes = files[WORKSPACE_PATH] as Uint8Array;
  if (
    workspaceBytes.byteLength !== parsedManifest.workspace.size ||
    (await sha256Bytes(workspaceBytes)) !== parsedManifest.workspace.sha256
  )
    failInterchange('ARCHIVE_INTEGRITY', 'Workspace checksum is invalid');
  const workspace = validateArchiveWorkspace(
    decodeJson(workspaceBytes, 'Archive workspace'),
  );
  const attachments: ArchiveAttachment[] = [];
  for (const entry of parsedManifest.attachments) {
    const attachmentBytes = files[entry.path];
    if (
      attachmentBytes?.byteLength !== entry.size ||
      (await sha256Bytes(attachmentBytes)) !== entry.sha256
    )
      failInterchange('ARCHIVE_INTEGRITY', 'Attachment checksum is invalid', {
        attachmentId: entry.id,
      });
    const { path: _path, ...attachmentDescriptor } = entry;
    void _path;
    attachments.push({
      bytes: attachmentBytes,
      descriptor: attachmentDescriptor,
    });
  }
  assertAttachmentSet(workspace, attachments);
  return { attachments, manifest: parsedManifest, workspace };
}

export async function waterLilyArchiveHash(bytes: Uint8Array): Promise<string> {
  return sha256Bytes(bytes);
}
