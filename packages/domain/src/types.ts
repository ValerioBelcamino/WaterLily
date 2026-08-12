export const NODE_KINDS = [
  'message',
  'note',
  'excerpt',
  'summary',
  'attachment',
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export const MESSAGE_ROLES = ['system', 'user', 'assistant', 'tool'] as const;

export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const EDGE_KINDS = ['context', 'provenance', 'reference'] as const;

export type EdgeKind = (typeof EDGE_KINDS)[number];

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface TextContentBlock {
  readonly format: 'markdown' | 'plain';
  readonly id: string;
  readonly text: string;
  readonly type: 'text';
}

export interface AttachmentContentBlock {
  readonly attachmentId: string;
  readonly id: string;
  readonly mediaType: string;
  readonly name: string | null;
  readonly type: 'attachment';
}

export type ContentBlock = AttachmentContentBlock | TextContentBlock;

export interface GraphNode {
  readonly createdAt: string;
  readonly currentRevisionId: string;
  readonly deletedAt: string | null;
  readonly id: string;
  readonly kind: NodeKind;
  readonly role: MessageRole | null;
  readonly tags: readonly string[];
  readonly title: string | null;
  readonly updatedAt: string;
}

export interface NodeRevision {
  readonly blocks: readonly ContentBlock[];
  readonly createdAt: string;
  readonly id: string;
  readonly metadata: Readonly<Record<string, JsonValue>>;
  readonly nodeId: string;
}

interface BaseEdge {
  readonly createdAt: string;
  readonly id: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
}

export interface ContextEdge extends BaseEdge {
  readonly kind: 'context';
  readonly label: string | null;
  readonly slot: number;
  readonly sourceRevisionId: string;
}

export type ProvenanceRelation =
  'derived' | 'excerpted' | 'imported' | 'summarized';

export interface ProvenanceEdge extends BaseEdge {
  readonly kind: 'provenance';
  readonly relation: ProvenanceRelation;
  readonly sourceRevisionId: string;
}

export interface ReferenceEdge extends BaseEdge {
  readonly kind: 'reference';
  readonly label: string | null;
}

export type GraphEdge = ContextEdge | ProvenanceEdge | ReferenceEdge;

export interface GraphSnapshot {
  readonly createdAt: string;
  readonly edges: Readonly<Record<string, GraphEdge>>;
  readonly id: string;
  readonly nodes: Readonly<Record<string, GraphNode>>;
  readonly revisions: Readonly<Record<string, NodeRevision>>;
  readonly updatedAt: string;
  readonly version: 1;
}

export interface CreateGraphInput {
  readonly createdAt: string;
  readonly graphId: string;
}

export interface CreateNodeInput {
  readonly blocks: readonly ContentBlock[];
  readonly createdAt: string;
  readonly kind: NodeKind;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
  readonly nodeId: string;
  readonly revisionId: string;
  readonly role?: MessageRole | null;
  readonly tags?: readonly string[];
  readonly title?: string | null;
}

export interface ReviseNodeInput {
  readonly blocks: readonly ContentBlock[];
  readonly createdAt: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
  readonly nodeId: string;
  readonly revisionId: string;
}

export interface ConnectContextInput {
  readonly createdAt: string;
  readonly edgeId: string;
  readonly label?: string | null;
  readonly slot: number;
  readonly sourceNodeId: string;
  readonly sourceRevisionId?: string;
  readonly targetNodeId: string;
}

export interface ConnectProvenanceInput {
  readonly createdAt: string;
  readonly edgeId: string;
  readonly relation: ProvenanceRelation;
  readonly sourceNodeId: string;
  readonly sourceRevisionId?: string;
  readonly targetNodeId: string;
}

export interface ConnectReferenceInput {
  readonly createdAt: string;
  readonly edgeId: string;
  readonly label?: string | null;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
}
