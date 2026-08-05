import { validateGraph, type GraphSnapshot } from '@waterlily/domain';

import { canonicalJson, sha256 } from './canonical.js';
import { failInterchange, InterchangeError } from './errors.js';
import type {
  CanvasPosition,
  CreateGraphDocumentInput,
  ExportedGraphDocument,
  GraphDocumentV1,
  GraphImportPreview,
  GraphViewGroup,
  GraphViewState,
} from './types.js';

const FORMAT = 'waterlily/graph';
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/u;
const FORBIDDEN_METADATA_KEYS = new Set([
  'accesskey',
  'apikey',
  'authorization',
  'credential',
  'credentials',
  'password',
  'secret',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    failInterchange(
      'INVALID_DOCUMENT',
      `${path} has unsupported or missing fields`,
      {
        path,
      },
    );
  }
}

function assertTimestamp(
  value: unknown,
  path: string,
): asserts value is string {
  if (typeof value !== 'string') {
    failInterchange(
      'INVALID_DOCUMENT',
      `${path} must be a canonical timestamp`,
      { path },
    );
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    failInterchange(
      'INVALID_DOCUMENT',
      `${path} must be a canonical timestamp`,
      { path },
    );
  }
}

function assertPortableId(
  value: unknown,
  path: string,
): asserts value is string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    failInterchange(
      'INVALID_DOCUMENT',
      `${path} must be a portable identifier`,
      { path },
    );
  }
}

function assertNoCredentials(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertNoCredentials(item, `${path}[${String(index)}]`);
    });
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll(/[^a-z]/gu, '');
    if (FORBIDDEN_METADATA_KEYS.has(normalized)) {
      failInterchange(
        'CREDENTIAL_MATERIAL',
        'Graph documents cannot contain credential-shaped fields',
        { path: `${path}.${key}` },
      );
    }
    assertNoCredentials(item, `${path}.${key}`);
  }
}

function assertNoAttachmentBlocks(graph: GraphSnapshot): void {
  const attachmentBlocks = Object.values(graph.revisions).flatMap((revision) =>
    revision.blocks.filter((block) => block.type === 'attachment'),
  );
  if (attachmentBlocks.length > 0) {
    failInterchange(
      'ATTACHMENTS_REQUIRE_ARCHIVE',
      'Attachment blocks require the future checksummed archive format',
      { attachmentBlocks: attachmentBlocks.length },
    );
  }
}

function normalizeView(
  graph: GraphSnapshot,
  view: Partial<GraphViewState> | undefined,
): GraphViewState {
  const positions = view?.positions ?? {};
  const normalizedPositions: Record<string, CanvasPosition> = {};
  for (const [nodeId, position] of Object.entries(positions)) {
    if (
      graph.nodes[nodeId] === undefined ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    ) {
      failInterchange(
        'INVALID_DOCUMENT',
        'View positions must target nodes with finite values',
        {
          nodeId,
        },
      );
    }
    normalizedPositions[nodeId] = { x: position.x, y: position.y };
  }

  const groups = view?.groups ?? [];
  const groupIds = new Set<string>();
  const groupedNodes = new Set<string>();
  const normalizedGroups = groups.map((group): GraphViewGroup => {
    assertPortableId(group.id, 'view.groups[].id');
    if (groupIds.has(group.id)) {
      failInterchange(
        'INVALID_DOCUMENT',
        'View group identifiers must be unique',
        {
          groupId: group.id,
        },
      );
    }
    groupIds.add(group.id);
    if (group.title.trim().length === 0 || !COLOR_PATTERN.test(group.color)) {
      failInterchange(
        'INVALID_DOCUMENT',
        'View groups require a title and hex color',
        {
          groupId: group.id,
        },
      );
    }
    if (new Set(group.nodeIds).size !== group.nodeIds.length) {
      failInterchange('INVALID_DOCUMENT', 'A view group cannot repeat a node', {
        groupId: group.id,
      });
    }
    for (const nodeId of group.nodeIds) {
      if (graph.nodes[nodeId] === undefined || groupedNodes.has(nodeId)) {
        failInterchange(
          'INVALID_DOCUMENT',
          'Grouped nodes must exist and belong to at most one group',
          { groupId: group.id, nodeId },
        );
      }
      groupedNodes.add(nodeId);
    }
    return {
      collapsed: group.collapsed,
      color: group.color,
      id: group.id,
      nodeIds: [...group.nodeIds],
      title: group.title,
    };
  });
  return { groups: normalizedGroups, positions: normalizedPositions };
}

function validateDocumentValue(value: unknown): GraphDocumentV1 {
  if (!isRecord(value)) {
    failInterchange(
      'INVALID_DOCUMENT',
      'Graph document root must be an object',
    );
  }
  if (value.schemaVersion !== 1 || value.format !== FORMAT) {
    failInterchange(
      'UNSUPPORTED_VERSION',
      'Graph document version or format is unsupported',
    );
  }
  exactKeys(
    value,
    ['exportedAt', 'exporter', 'format', 'graph', 'schemaVersion', 'view'],
    '$',
  );
  assertTimestamp(value.exportedAt, '$.exportedAt');
  if (!isRecord(value.exporter)) {
    failInterchange('INVALID_DOCUMENT', '$.exporter must be an object');
  }
  exactKeys(value.exporter, ['name', 'version'], '$.exporter');
  if (
    typeof value.exporter.name !== 'string' ||
    value.exporter.name.trim().length === 0 ||
    typeof value.exporter.version !== 'string' ||
    value.exporter.version.trim().length === 0
  ) {
    failInterchange(
      'INVALID_DOCUMENT',
      'Exporter name and version cannot be blank',
    );
  }
  if (!isRecord(value.graph)) {
    failInterchange('INVALID_DOCUMENT', '$.graph must be an object');
  }
  const graph = value.graph as unknown as GraphSnapshot;
  try {
    validateGraph(graph);
  } catch (cause) {
    throw new InterchangeError(
      'INVALID_DOCUMENT',
      'Embedded graph is invalid',
      {},
      { cause },
    );
  }
  assertNoAttachmentBlocks(graph);
  if (!isRecord(value.view)) {
    failInterchange('INVALID_DOCUMENT', '$.view must be an object');
  }
  exactKeys(value.view, ['groups', 'positions'], '$.view');
  if (!Array.isArray(value.view.groups) || !isRecord(value.view.positions)) {
    failInterchange(
      'INVALID_DOCUMENT',
      'View groups and positions have invalid shapes',
    );
  }
  for (const group of value.view.groups) {
    if (!isRecord(group)) {
      failInterchange('INVALID_DOCUMENT', 'Every view group must be an object');
    }
    exactKeys(
      group,
      ['collapsed', 'color', 'id', 'nodeIds', 'title'],
      '$.view.groups[]',
    );
    if (
      typeof group.collapsed !== 'boolean' ||
      typeof group.color !== 'string' ||
      typeof group.id !== 'string' ||
      !Array.isArray(group.nodeIds) ||
      group.nodeIds.some((nodeId) => typeof nodeId !== 'string') ||
      typeof group.title !== 'string'
    ) {
      failInterchange(
        'INVALID_DOCUMENT',
        'View group fields have invalid types',
      );
    }
  }
  for (const position of Object.values(value.view.positions)) {
    if (!isRecord(position)) {
      failInterchange(
        'INVALID_DOCUMENT',
        'Every view position must be an object',
      );
    }
    exactKeys(position, ['x', 'y'], '$.view.positions.*');
    if (typeof position.x !== 'number' || typeof position.y !== 'number') {
      failInterchange('INVALID_DOCUMENT', 'View coordinates must be numbers');
    }
  }
  const document = value as unknown as GraphDocumentV1;
  const view = normalizeView(graph, document.view);
  const normalized: GraphDocumentV1 = {
    exportedAt: value.exportedAt,
    exporter: {
      name: value.exporter.name,
      version: value.exporter.version,
    },
    format: FORMAT,
    graph,
    schemaVersion: 1,
    view,
  };
  assertNoCredentials(normalized);
  return structuredClone(normalized);
}

export function validateGraphDocument(value: unknown): GraphDocumentV1 {
  return validateDocumentValue(value);
}

export function createGraphDocument(
  input: CreateGraphDocumentInput,
): GraphDocumentV1 {
  validateGraph(input.graph);
  assertNoAttachmentBlocks(input.graph);
  assertTimestamp(input.exportedAt, 'exportedAt');
  const document: GraphDocumentV1 = {
    exportedAt: input.exportedAt,
    exporter: structuredClone(input.exporter),
    format: FORMAT,
    graph: structuredClone(input.graph),
    schemaVersion: 1,
    view: normalizeView(input.graph, input.view),
  };
  return validateDocumentValue(document);
}

export function serializeGraphDocument(document: GraphDocumentV1): string {
  return canonicalJson(validateDocumentValue(document));
}

export async function exportGraphDocument(
  input: CreateGraphDocumentInput,
): Promise<ExportedGraphDocument> {
  const document = createGraphDocument(input);
  const json = serializeGraphDocument(document);
  return { document, json, sha256: await sha256(json) };
}

export function parseGraphDocument(
  text: string,
  maxBytes = DEFAULT_MAX_BYTES,
): GraphDocumentV1 {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    failInterchange(
      'INVALID_DOCUMENT',
      'Import size limit must be a positive integer',
    );
  }
  if (
    text.length > maxBytes ||
    new TextEncoder().encode(text).byteLength > maxBytes
  ) {
    failInterchange(
      'DOCUMENT_TOO_LARGE',
      'Graph document exceeds the import size limit',
      {
        maxBytes,
      },
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new InterchangeError(
      'INVALID_DOCUMENT',
      'Graph document is not valid JSON',
      {},
      {
        cause,
      },
    );
  }
  return validateDocumentValue(value);
}

export function previewGraphDocument(
  document: GraphDocumentV1,
): GraphImportPreview {
  const validated = validateDocumentValue(document);
  const edgeCounts = { context: 0, provenance: 0, reference: 0 };
  for (const edge of Object.values(validated.graph.edges))
    edgeCounts[edge.kind] += 1;
  const attachmentBlocks = Object.values(validated.graph.revisions).reduce(
    (count, revision) =>
      count +
      revision.blocks.filter((block) => block.type === 'attachment').length,
    0,
  );
  return {
    attachmentBlocks,
    edgeCounts,
    exportedAt: validated.exportedAt,
    graphId: validated.graph.id,
    nodeCount: Object.keys(validated.graph.nodes).length,
    revisionCount: Object.keys(validated.graph.revisions).length,
  };
}
