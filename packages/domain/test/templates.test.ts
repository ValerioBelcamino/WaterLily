import {
  createGraph,
  createNode,
  extractTemplateVariables,
  resolveRevisionBlocks,
  resolveTemplate,
  removeTemplateBinding,
  reviseTextBlock,
  setTemplateBinding,
  TemplateError,
  validateGraph,
  resolveSelectedRevisionBlocks,
  type GraphSnapshot,
  type TextContentBlock,
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

const time = (seconds: number): string =>
  new Date(Date.UTC(2026, 7, 17, 12, 0, seconds)).toISOString();

function sourceGraph(): GraphSnapshot {
  let graph = createGraph({ createdAt: time(0), graphId: 'graph-template' });
  graph = createNode(graph, {
    blocks: [
      {
        format: 'markdown',
        id: 'block-source',
        text: 'proton gradient',
        type: 'text',
      },
    ],
    createdAt: time(1),
    kind: 'note',
    nodeId: 'node-source',
    revisionId: 'revision-source',
  });
  return createNode(graph, {
    blocks: [
      {
        format: 'markdown',
        id: 'block-template',
        template: { bindings: [], version: 1 },
        text: 'Explain {{topic}}. Literal: \\{{example}}.',
        type: 'text',
      },
    ],
    createdAt: time(2),
    kind: 'message',
    nodeId: 'node-template',
    revisionId: 'revision-template',
    role: 'user',
  });
}

describe('text templates', () => {
  it('parses variables and applies deterministic backslash escaping', () => {
    expect(
      extractTemplateVariables(
        String.raw`{{first}} \{{literal}} \\{{second}} {{first}}`,
      ),
    ).toEqual(['first', 'second']);
    expect(
      resolveTemplate(
        String.raw`{{first}} \{{literal}} \\{{second}} {{first}}`,
        { first: 'A', second: 'B' },
      ),
    ).toBe(String.raw`A {{literal}} \B A`);
    expect(extractTemplateVariables(String.raw`path\to\file`)).toEqual([]);
    expect(resolveTemplate(String.raw`path\to\file`, {})).toBe(
      String.raw`path\to\file`,
    );
  });

  it('resolves pinned graph sources exactly once', () => {
    const graph = setTemplateBinding(sourceGraph(), {
      createdAt: time(3),
      name: 'topic',
      nodeId: 'node-template',
      revisionId: 'revision-template-bound',
      sourceNodeId: 'node-source',
      targetBlockId: 'block-template',
    });
    const blocks = resolveRevisionBlocks(graph, 'revision-template-bound');
    expect(blocks[0]).toMatchObject({
      text: 'Explain proton gradient. Literal: {{example}}.',
    });
    expect(graph.revisions['revision-template-bound']?.blocks[0]).toMatchObject(
      {
        template: {
          bindings: [
            {
              name: 'topic',
              sourceBlockId: null,
              sourceNodeId: 'node-source',
              sourceRevisionId: 'revision-source',
            },
          ],
        },
      },
    );
  });

  it('never recursively evaluates braces inserted by a binding', () => {
    expect(resolveTemplate('{{value}}', { value: '{{secret}}' })).toBe(
      '{{secret}}',
    );
  });

  it('enforces resolution limits and selected-revision failures', () => {
    expect(() =>
      resolveTemplate('{{large}}', { large: 'x'.repeat(1024 * 1024 + 1) }),
    ).toThrow('1 MiB');
    expect(() => resolveTemplate('x'.repeat(1024 * 1024 + 1), {})).toThrow(
      '1 MiB',
    );
    expect(() => resolveRevisionBlocks(sourceGraph(), 'missing')).toThrow(
      'unavailable',
    );
    expect(() =>
      resolveSelectedRevisionBlocks(sourceGraph(), 'missing', new Set()),
    ).toThrow('unavailable');

    const base = sourceGraph();
    const revision = base.revisions['revision-template'];
    if (revision === undefined) throw new TypeError('fixture');
    const withAttachment: GraphSnapshot = {
      ...base,
      revisions: {
        ...base.revisions,
        'revision-template': {
          ...revision,
          blocks: [
            ...revision.blocks,
            {
              attachmentId: 'attachment-template',
              id: 'block-attachment',
              mediaType: 'text/plain',
              name: 'data.txt',
              type: 'attachment',
            },
          ],
        },
      },
    };
    expect(
      resolveSelectedRevisionBlocks(
        withAttachment,
        'revision-template',
        new Set(['block-attachment']),
      ),
    ).toEqual([
      {
        attachmentId: 'attachment-template',
        id: 'block-attachment',
        mediaType: 'text/plain',
        name: 'data.txt',
        type: 'attachment',
      },
    ]);
  });

  it('edits template text as immutable revisions and removes stale pins', () => {
    const bound = setTemplateBinding(sourceGraph(), {
      createdAt: time(3),
      name: 'topic',
      nodeId: 'node-template',
      revisionId: 'revision-template-bound',
      sourceNodeId: 'node-source',
      targetBlockId: 'block-template',
    });
    const edited = reviseTextBlock(bound, {
      blockId: 'block-template',
      createdAt: time(4),
      nodeId: 'node-template',
      revisionId: 'revision-template-edited',
      text: 'Keep {{new_topic}}, drop the old pin.',
    });
    expect(edited.nodes['node-template']?.currentRevisionId).toBe(
      'revision-template-edited',
    );
    expect(edited.revisions['revision-template-bound']).toBe(
      bound.revisions['revision-template-bound'],
    );
    expect(
      edited.revisions['revision-template-edited']?.blocks[0],
    ).toMatchObject({
      template: { bindings: [], version: 1 },
      text: 'Keep {{new_topic}}, drop the old pin.',
    });

    const unbound = removeTemplateBinding(bound, {
      createdAt: time(5),
      name: 'topic',
      nodeId: 'node-template',
      revisionId: 'revision-template-unbound',
      targetBlockId: 'block-template',
    });
    expect(
      unbound.revisions['revision-template-unbound']?.blocks[0],
    ).toMatchObject({ template: { bindings: [] } });
  });

  it('sorts, replaces, and removes multiple exact source pins', () => {
    const edited = reviseTextBlock(sourceGraph(), {
      blockId: 'block-template',
      createdAt: time(3),
      nodeId: 'node-template',
      revisionId: 'revision-template-two-variables',
      text: '{{topic}} + {{other}}',
    });
    const other = setTemplateBinding(edited, {
      createdAt: time(4),
      name: 'other',
      nodeId: 'node-template',
      revisionId: 'revision-template-other',
      sourceBlockId: 'block-source',
      sourceNodeId: 'node-source',
      sourceRevisionId: 'revision-source',
      targetBlockId: 'block-template',
    });
    const both = setTemplateBinding(other, {
      createdAt: time(5),
      name: 'topic',
      nodeId: 'node-template',
      revisionId: 'revision-template-both',
      sourceNodeId: 'node-source',
      targetBlockId: 'block-template',
    });
    expect(
      (
        both.revisions['revision-template-both']?.blocks[0] as TextContentBlock
      ).template?.bindings.map((binding) => binding.name),
    ).toEqual(['other', 'topic']);

    const replaced = setTemplateBinding(both, {
      createdAt: time(6),
      name: 'topic',
      nodeId: 'node-template',
      revisionId: 'revision-template-topic-replaced',
      sourceBlockId: 'block-source',
      sourceNodeId: 'node-source',
      targetBlockId: 'block-template',
    });
    const removed = removeTemplateBinding(replaced, {
      createdAt: time(7),
      name: 'topic',
      nodeId: 'node-template',
      revisionId: 'revision-template-topic-removed',
      targetBlockId: 'block-template',
    });
    expect(
      (
        removed.revisions['revision-template-topic-removed']
          ?.blocks[0] as TextContentBlock
      ).template?.bindings.map((binding) => binding.name),
    ).toEqual(['other']);
  });

  it('rejects missing blocks and invalid source block pins', () => {
    expect(() =>
      setTemplateBinding(sourceGraph(), {
        createdAt: time(3),
        name: 'topic',
        nodeId: 'node-template',
        revisionId: 'revision-bad-source-block',
        sourceBlockId: 'missing',
        sourceNodeId: 'node-source',
        targetBlockId: 'block-template',
      }),
    ).toThrow('source block');
    expect(() =>
      setTemplateBinding(sourceGraph(), {
        createdAt: time(3),
        name: 'topic',
        nodeId: 'node-template',
        revisionId: 'revision-bad-target-block',
        sourceNodeId: 'node-source',
        targetBlockId: 'missing',
      }),
    ).toThrow('target template block');
    expect(() =>
      reviseTextBlock(sourceGraph(), {
        blockId: 'missing',
        createdAt: time(3),
        nodeId: 'node-template',
        revisionId: 'revision-bad-edit',
        text: 'No block',
      }),
    ).toThrow('editable text block');
    expect(() =>
      removeTemplateBinding(sourceGraph(), {
        createdAt: time(3),
        name: 'topic',
        nodeId: 'node-template',
        revisionId: 'revision-bad-unbind',
        targetBlockId: 'block-template',
      }),
    ).toThrow('binding is unavailable');
  });

  it('rejects malformed and unresolved templates', () => {
    expect(() => extractTemplateVariables('{{bad name}}')).toThrow(
      TemplateError,
    );
    expect(() => extractTemplateVariables('{{missing')).toThrow(
      'closing braces',
    );
    expect(() => resolveTemplate('{{missing}}', {})).toThrow('not connected');
    expect(() =>
      resolveRevisionBlocks(sourceGraph(), 'revision-template'),
    ).toThrow('topic is not connected');
  });

  it('rejects stale, missing, and cyclic persisted bindings', () => {
    const base = sourceGraph();
    expect(() =>
      setTemplateBinding(base, {
        createdAt: time(3),
        name: 'absent',
        nodeId: 'node-template',
        revisionId: 'revision-bad',
        sourceNodeId: 'node-source',
        targetBlockId: 'block-template',
      }),
    ).toThrow('no matching variable');

    const sourceBlock = base.revisions['revision-source']?.blocks[0];
    if (sourceBlock?.type !== 'text') throw new TypeError('fixture');
    const templateBlock = base.revisions['revision-template']?.blocks[0];
    if (templateBlock?.type !== 'text') throw new TypeError('fixture');
    const cyclicSourceBlock: TextContentBlock = {
      ...sourceBlock,
      template: {
        bindings: [
          {
            name: 'back',
            sourceBlockId: 'block-template',
            sourceNodeId: 'node-template',
            sourceRevisionId: 'revision-template',
          },
        ],
        version: 1,
      },
      text: '{{back}}',
    };
    const cyclicTemplateBlock: TextContentBlock = {
      ...templateBlock,
      template: {
        bindings: [
          {
            name: 'topic',
            sourceBlockId: 'block-source',
            sourceNodeId: 'node-source',
            sourceRevisionId: 'revision-source',
          },
        ],
        version: 1,
      },
    };
    const cyclic: GraphSnapshot = {
      ...base,
      revisions: {
        ...base.revisions,
        'revision-source': {
          ...(base.revisions['revision-source'] as NonNullable<
            (typeof base.revisions)[string]
          >),
          blocks: [cyclicSourceBlock],
        },
        'revision-template': {
          ...(base.revisions['revision-template'] as NonNullable<
            (typeof base.revisions)[string]
          >),
          blocks: [cyclicTemplateBlock],
        },
      },
    };
    expect(() => validateGraph(cyclic)).toThrow('cycle');
    expect(() => resolveRevisionBlocks(cyclic, 'revision-template')).toThrow(
      'dependency cycle',
    );
  });

  it('validates every persisted binding boundary', () => {
    const bound = setTemplateBinding(sourceGraph(), {
      createdAt: time(3),
      name: 'topic',
      nodeId: 'node-template',
      revisionId: 'revision-template-bound',
      sourceNodeId: 'node-source',
      targetBlockId: 'block-template',
    });
    const revision = bound.revisions['revision-template-bound'];
    const block = revision?.blocks[0];
    if (revision === undefined || block?.type !== 'text')
      throw new TypeError('fixture');
    const binding = block.template?.bindings[0];
    if (binding === undefined) throw new TypeError('fixture');
    const withBlock = (
      nextBlock: TextContentBlock,
      graph: GraphSnapshot = bound,
    ): GraphSnapshot => ({
      ...graph,
      revisions: {
        ...graph.revisions,
        'revision-template-bound': { ...revision, blocks: [nextBlock] },
      },
    });
    const withBinding = (
      nextBinding: typeof binding,
      text = block.text,
    ): GraphSnapshot =>
      withBlock({
        ...block,
        template: { bindings: [nextBinding], version: 1 },
        text,
      });

    expect(() =>
      validateGraph(withBinding({ ...binding, name: 'bad name' })),
    ).toThrow('name is invalid');
    expect(() =>
      validateGraph(withBinding({ ...binding, sourceNodeId: 'node-template' })),
    ).toThrow('invalid source revision');
    expect(() =>
      validateGraph(
        withBinding({ ...binding, sourceBlockId: 'missing-block' }),
      ),
    ).toThrow('missing text block');
    expect(() =>
      validateGraph(
        withBlock({
          ...block,
          template: {
            bindings: [binding],
            version: 2,
          },
        } as unknown as TextContentBlock),
      ),
    ).toThrow('template is unsupported');
    expect(() => validateGraph(withBinding(binding, '{{unfinished'))).toThrow(
      'closing braces',
    );
    expect(() =>
      validateGraph(
        withBlock({
          ...block,
          template: { bindings: [binding, binding], version: 1 },
        }),
      ),
    ).toThrow('repeats a template binding');
    expect(() => validateGraph(withBinding(binding, 'No variable'))).toThrow(
      'absent from its template',
    );

    const sourceRevision = bound.revisions['revision-source'];
    if (sourceRevision === undefined) throw new TypeError('fixture');
    const attachmentSource: GraphSnapshot = {
      ...bound,
      revisions: {
        ...bound.revisions,
        'revision-source': {
          ...sourceRevision,
          blocks: [
            {
              attachmentId: 'attachment-source',
              id: 'block-source-file',
              mediaType: 'text/plain',
              name: null,
              type: 'attachment',
            },
          ],
        },
      },
    };
    expect(() => validateGraph(attachmentSource)).toThrow(
      'source with no text',
    );

    for (const template of [
      null,
      { bindings: {}, version: 1 },
      { bindings: [null], version: 1 },
      {
        bindings: [{ ...binding, sourceBlockId: 42 }],
        version: 1,
      },
    ]) {
      expect(() =>
        validateGraph(
          withBlock({
            ...block,
            template,
          } as unknown as TextContentBlock),
        ),
      ).toThrow();
    }
  });
});
