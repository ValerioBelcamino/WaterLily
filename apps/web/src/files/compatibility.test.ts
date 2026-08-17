import { createGraph, createNode } from '@waterlily/domain';
import { describe, expect, it } from 'vitest';

import {
  attachmentCompatibility,
  attachmentCompatibilityByNode,
} from './compatibility';

const block = {
  attachmentId: 'attachment-1',
  id: 'block-file',
  mediaType: 'application/octet-stream',
  name: 'notes.pdf',
  type: 'attachment' as const,
};

const nativeModel = {
  capabilities: {
    inputExtensions: ['pdf'],
    inputMimeTypes: ['image/png'],
    maxFileBytes: 100,
    nativeFiles: true,
  },
  id: 'model',
  name: 'Model',
};

describe('attachment compatibility', () => {
  it('uses model MIME, extension, size, and native-file capabilities', () => {
    expect(attachmentCompatibility(block, null, 10)).toBe('unknown');
    expect(
      attachmentCompatibility(
        block,
        {
          ...nativeModel,
          capabilities: { ...nativeModel.capabilities, nativeFiles: false },
        },
        10,
      ),
    ).toBe('unsupported');
    expect(attachmentCompatibility(block, nativeModel, 10)).toBe('supported');
    expect(
      attachmentCompatibility(
        { ...block, mediaType: 'image/png', name: null },
        nativeModel,
        10,
      ),
    ).toBe('supported');
    expect(attachmentCompatibility(block, nativeModel, null)).toBe(
      'unsupported',
    );
    expect(attachmentCompatibility(block, nativeModel, 101)).toBe(
      'unsupported',
    );
    expect(
      attachmentCompatibility(
        { ...block, name: 'unknown.bin' },
        {
          ...nativeModel,
          capabilities: { ...nativeModel.capabilities, maxFileBytes: null },
        },
        null,
      ),
    ).toBe('unsupported');
  });

  it('summarizes all attachment blocks on each graph node', () => {
    let graph = createGraph({
      createdAt: '2026-08-17T10:00:00.000Z',
      graphId: 'graph-files',
    });
    graph = createNode(graph, {
      blocks: [
        block,
        {
          ...block,
          attachmentId: 'attachment-2',
          id: 'block-image',
          mediaType: 'image/png',
          name: 'image.png',
        },
      ],
      createdAt: '2026-08-17T10:00:00.000Z',
      kind: 'attachment',
      metadata: { file: { size: 20 } },
      nodeId: 'node-file',
      revisionId: 'revision-file',
    });
    graph = createNode(graph, {
      blocks: [
        { format: 'plain', id: 'block-note', text: 'No file', type: 'text' },
      ],
      createdAt: '2026-08-17T10:00:01.000Z',
      kind: 'note',
      nodeId: 'node-note',
      revisionId: 'revision-note',
    });
    expect(attachmentCompatibilityByNode(graph, nativeModel)).toEqual({
      'node-file': 'supported',
    });
    expect(attachmentCompatibilityByNode(graph, null)).toEqual({
      'node-file': 'unknown',
    });
    expect(
      attachmentCompatibilityByNode(
        {
          ...graph,
          revisions: {
            ...graph.revisions,
            'revision-file': {
              ...(graph.revisions['revision-file'] as NonNullable<
                (typeof graph.revisions)['revision-file']
              >),
              metadata: { file: [] },
            },
          },
        },
        nativeModel,
      ),
    ).toEqual({ 'node-file': 'unsupported' });
  });
});
