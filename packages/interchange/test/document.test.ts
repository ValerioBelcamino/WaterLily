import { createNode, type GraphSnapshot } from '@waterlily/domain';
import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  createGraphDocument,
  exportGraphDocument,
  InterchangeError,
  parseGraphDocument,
  previewGraphDocument,
  serializeGraphDocument,
  validateGraphDocument,
  validateGraphViewState,
} from '../src/index.js';
import { documentInput, sampleDocument, sampleGraph, time } from './helpers.js';

describe('graph documents', () => {
  it('exports canonical, deterministic JSON with a content hash', async () => {
    const first = await exportGraphDocument(documentInput());
    const graph = sampleGraph();
    const reordered: GraphSnapshot = {
      ...graph,
      edges: Object.fromEntries(Object.entries(graph.edges).reverse()),
      nodes: Object.fromEntries(Object.entries(graph.nodes).reverse()),
      revisions: Object.fromEntries(Object.entries(graph.revisions).reverse()),
    };
    const second = await exportGraphDocument({
      ...documentInput(),
      graph: reordered,
    });

    expect(first.json.endsWith('\n')).toBe(true);
    expect(first.json).not.toContain('\n  ');
    expect(first.json).toBe(second.json);
    expect(first.sha256).toBe(second.sha256);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(parseGraphDocument(first.json)).toEqual(first.document);
  });

  it('returns an import preview by semantic edge kind', () => {
    expect(previewGraphDocument(sampleDocument())).toEqual({
      attachmentBlocks: 0,
      edgeCounts: { context: 2, provenance: 1, reference: 1 },
      exportedAt: time(20),
      graphId: 'source-graph',
      nodeCount: 4,
      revisionCount: 4,
    });
  });

  it('uses empty view defaults and protects the graph from caller mutation', () => {
    const input = documentInput();
    const document = createGraphDocument({
      exportedAt: input.exportedAt,
      exporter: input.exporter,
      graph: input.graph,
    });
    (input.graph.nodes as Record<string, unknown>).mutated = {};

    expect(document.view).toEqual({ groups: [], positions: {} });
    expect(document.graph.nodes).not.toHaveProperty('mutated');
  });

  it('rejects attachment references until the archive format is implemented', () => {
    const graph = createNode(sampleGraph(), {
      blocks: [
        {
          attachmentId: 'asset-1',
          id: 'block-attachment',
          mediaType: 'application/pdf',
          name: 'paper.pdf',
          type: 'attachment',
        },
      ],
      createdAt: time(9),
      kind: 'attachment',
      nodeId: 'node-attachment',
      revisionId: 'revision-attachment',
    });
    expect(() => createGraphDocument({ ...documentInput(), graph })).toThrow(
      expect.objectContaining({ code: 'ATTACHMENTS_REQUIRE_ARCHIVE' }),
    );
    expect(
      validateGraphViewState(graph, { groups: [], positions: {} }),
    ).toEqual({ groups: [], positions: {} });
  });

  it('rejects credential-shaped metadata keys without scanning message text', () => {
    let graph = sampleGraph();
    graph = createNode(graph, {
      blocks: [
        {
          format: 'plain',
          id: 'block-safe',
          text: 'The word apiKey can be studied as ordinary content.',
          type: 'text',
        },
      ],
      createdAt: time(9),
      kind: 'note',
      metadata: { apiKey: 'must-not-export' },
      nodeId: 'node-secret',
      revisionId: 'revision-secret',
    });
    expect(() => createGraphDocument({ ...documentInput(), graph })).toThrow(
      expect.objectContaining({ code: 'CREDENTIAL_MATERIAL' }),
    );
  });

  it('enforces byte size limits and preserves JSON parse causes', () => {
    expect(() => parseGraphDocument('{}', 0)).toThrow('positive integer');
    expect(() => parseGraphDocument('é', 1)).toThrow(
      expect.objectContaining({ code: 'DOCUMENT_TOO_LARGE' }),
    );
    const error = (() => {
      try {
        parseGraphDocument('{broken');
      } catch (cause) {
        return cause;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(InterchangeError);
    expect((error as InterchangeError).cause).toBeInstanceOf(SyntaxError);
  });

  it('rejects primitives that canonical JSON cannot represent', () => {
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
  });

  it.each([
    { mutate: () => [] as unknown, message: 'root must be an object' },
    {
      mutate: () => ({ ...sampleDocument(), schemaVersion: 2 }),
      message: 'version or format is unsupported',
    },
    {
      mutate: () => ({ ...sampleDocument(), extra: true }),
      message: 'unsupported or missing fields',
    },
    {
      mutate: () => ({ ...sampleDocument(), exportedAt: 'yesterday' }),
      message: 'canonical timestamp',
    },
    {
      mutate: () => ({ ...sampleDocument(), exporter: null }),
      message: 'exporter must be an object',
    },
    {
      mutate: () => ({
        ...sampleDocument(),
        exporter: { name: '', version: '1' },
      }),
      message: 'cannot be blank',
    },
    {
      mutate: () => ({ ...sampleDocument(), graph: null }),
      message: 'graph must be an object',
    },
    {
      mutate: () => ({
        ...sampleDocument(),
        graph: { ...sampleDocument().graph, version: 2 },
      }),
      message: 'Embedded graph is invalid',
    },
    {
      mutate: () => ({ ...sampleDocument(), view: null }),
      message: 'view must be an object',
    },
    {
      mutate: () => ({
        ...sampleDocument(),
        view: { groups: 'bad', positions: {} },
      }),
      message: 'invalid shapes',
    },
    {
      mutate: () => ({
        ...sampleDocument(),
        view: { groups: [null], positions: {} },
      }),
      message: 'group must be an object',
    },
    {
      mutate: () => ({
        ...sampleDocument(),
        view: { groups: [{ collapsed: false }], positions: {} },
      }),
      message: 'unsupported or missing fields',
    },
    {
      mutate: () => ({
        ...sampleDocument(),
        view: {
          groups: [
            {
              collapsed: 'no',
              color: '#000000',
              id: 'g',
              nodeIds: [],
              title: 'g',
            },
          ],
          positions: {},
        },
      }),
      message: 'invalid types',
    },
    {
      mutate: () => ({
        ...sampleDocument(),
        view: { groups: [], positions: { 'node-user': null } },
      }),
      message: 'position must be an object',
    },
    {
      mutate: () => ({
        ...sampleDocument(),
        view: { groups: [], positions: { 'node-user': { x: '0', y: 0 } } },
      }),
      message: 'coordinates must be numbers',
    },
  ])('rejects invalid document shape %#', ({ mutate, message }) => {
    expect(() => validateGraphDocument(mutate())).toThrow(message);
  });

  it.each([
    {
      groups: [
        {
          collapsed: false,
          color: '#000000',
          id: 'bad id',
          nodeIds: [],
          title: 'g',
        },
      ],
      positions: {},
    },
    {
      groups: [
        { collapsed: false, color: 'green', id: 'g', nodeIds: [], title: 'g' },
      ],
      positions: {},
    },
    {
      groups: [
        {
          collapsed: false,
          color: '#000000',
          id: 'g',
          nodeIds: ['node-user', 'node-user'],
          title: 'g',
        },
      ],
      positions: {},
    },
    {
      groups: [
        {
          collapsed: false,
          color: '#000000',
          id: 'g',
          nodeIds: ['missing'],
          title: 'g',
        },
      ],
      positions: {},
    },
    { groups: [], positions: { missing: { x: 0, y: 0 } } },
    { groups: [], positions: { 'node-user': { x: Number.NaN, y: 0 } } },
  ])('rejects invalid semantic view %#', (view) => {
    expect(() => createGraphDocument({ ...documentInput(), view })).toThrow(
      expect.objectContaining({ code: 'INVALID_DOCUMENT' }),
    );
  });

  it('serializes only validated documents', () => {
    const bad = {
      ...sampleDocument(),
      format: 'other',
    } as unknown as ReturnType<typeof sampleDocument>;
    expect(() => serializeGraphDocument(bad)).toThrow('unsupported');
  });
});
