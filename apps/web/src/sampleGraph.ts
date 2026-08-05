import {
  connectContext,
  connectProvenance,
  connectReference,
  createGraph,
  createNode,
  type GraphSnapshot,
} from '@waterlily/domain';

const BASE_TIME = '2026-08-05T12:00:00.000Z';

interface SampleNode {
  readonly id: string;
  readonly kind: 'message' | 'note' | 'summary';
  readonly role: 'assistant' | 'system' | 'user' | null;
  readonly text: string;
  readonly title: string;
}

const nodes: readonly SampleNode[] = [
  {
    id: 'node-system',
    kind: 'message',
    role: 'system',
    text: 'Teach with precise language, surface assumptions, and invite follow-up questions.',
    title: 'Study guide',
  },
  {
    id: 'node-question',
    kind: 'message',
    role: 'user',
    text: 'How does oxidative phosphorylation turn a proton gradient into ATP?',
    title: 'Core question',
  },
  {
    id: 'node-answer',
    kind: 'message',
    role: 'assistant',
    text: 'The electron transport chain pumps protons across the inner mitochondrial membrane. Their return through ATP synthase drives rotation and couples that motion to ATP formation.',
    title: 'Mechanism overview',
  },
  {
    id: 'node-side-question',
    kind: 'message',
    role: 'user',
    text: 'Side question: what exactly is the proton-motive force?',
    title: 'Proton-motive force',
  },
  {
    id: 'node-side-answer',
    kind: 'message',
    role: 'assistant',
    text: 'It is the stored electrochemical potential made from a voltage difference and a proton concentration difference across the membrane.',
    title: 'Side answer',
  },
  {
    id: 'node-note',
    kind: 'note',
    role: null,
    text: 'Analogy: the membrane stores potential like a dam, while ATP synthase is the turbine.',
    title: 'Dam analogy',
  },
  {
    id: 'node-synthesis',
    kind: 'summary',
    role: null,
    text: 'Synthesis: electron transport builds both parts of the proton-motive force; ATP synthase converts their combined potential into chemical energy.',
    title: 'Merged understanding',
  },
];

function nextTime(index: number): string {
  return new Date(Date.parse(BASE_TIME) + index * 1_000).toISOString();
}

export function createSampleGraph(): GraphSnapshot {
  let graph = createGraph({
    createdAt: BASE_TIME,
    graphId: 'graph-bioenergetics',
  });
  nodes.forEach((node, index) => {
    graph = createNode(graph, {
      blocks: [
        {
          format: 'markdown',
          id: `block-${node.id}`,
          text: node.text,
          type: 'text',
        },
      ],
      createdAt: nextTime(index + 1),
      kind: node.kind,
      nodeId: node.id,
      revisionId: `revision-${node.id}`,
      role: node.role,
      title: node.title,
    });
  });

  const contexts = [
    ['edge-system-question', 'node-system', 'node-question', 0],
    ['edge-question-answer', 'node-question', 'node-answer', 0],
    ['edge-answer-side-question', 'node-answer', 'node-side-question', 0],
    ['edge-side-question-answer', 'node-side-question', 'node-side-answer', 0],
    ['edge-answer-synthesis', 'node-answer', 'node-synthesis', 0],
    ['edge-side-answer-synthesis', 'node-side-answer', 'node-synthesis', 1],
  ] as const;
  contexts.forEach(([edgeId, sourceNodeId, targetNodeId, slot], index) => {
    graph = connectContext(graph, {
      createdAt: nextTime(nodes.length + index + 1),
      edgeId,
      slot,
      sourceNodeId,
      targetNodeId,
    });
  });

  graph = connectProvenance(graph, {
    createdAt: nextTime(20),
    edgeId: 'edge-answer-note',
    relation: 'derived',
    sourceNodeId: 'node-answer',
    targetNodeId: 'node-note',
  });
  return connectReference(graph, {
    createdAt: nextTime(21),
    edgeId: 'edge-synthesis-note',
    label: 'uses analogy',
    sourceNodeId: 'node-synthesis',
    targetNodeId: 'node-note',
  });
}

export const sampleGraph = createSampleGraph();
