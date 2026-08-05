import type { GraphSnapshot } from '@waterlily/domain';

export interface CanvasPosition {
  readonly x: number;
  readonly y: number;
}

export interface GraphViewGroup {
  readonly collapsed: boolean;
  readonly color: string;
  readonly id: string;
  readonly nodeIds: readonly string[];
  readonly title: string;
}

export interface GraphViewState {
  readonly groups: readonly GraphViewGroup[];
  readonly positions: Readonly<Record<string, CanvasPosition>>;
}

export interface GraphDocumentV1 {
  readonly exportedAt: string;
  readonly exporter: {
    readonly name: string;
    readonly version: string;
  };
  readonly format: 'waterlily/graph';
  readonly graph: GraphSnapshot;
  readonly schemaVersion: 1;
  readonly view: GraphViewState;
}

export interface CreateGraphDocumentInput {
  readonly exportedAt: string;
  readonly exporter: GraphDocumentV1['exporter'];
  readonly graph: GraphSnapshot;
  readonly view?: Partial<GraphViewState>;
}

export type ImportEntityKind = 'edge' | 'graph' | 'group' | 'node' | 'revision';
export type IdRemapper = (kind: ImportEntityKind, originalId: string) => string;

export interface ImportMapping {
  readonly edges: Readonly<Record<string, string>>;
  readonly graphId: string;
  readonly groups: Readonly<Record<string, string>>;
  readonly nodes: Readonly<Record<string, string>>;
  readonly revisions: Readonly<Record<string, string>>;
}

export interface ImportResult {
  readonly graph: GraphSnapshot;
  readonly mapping: ImportMapping;
  readonly view: GraphViewState;
}

export interface ImportGraphOptions {
  readonly graphId?: string;
  readonly remapId: IdRemapper;
}

export interface MergeGraphDocumentInput {
  readonly document: GraphDocumentV1;
  readonly remapId: IdRemapper;
  readonly targetGraph: GraphSnapshot;
  readonly targetView?: Partial<GraphViewState>;
}

export interface GraphImportPreview {
  readonly attachmentBlocks: number;
  readonly edgeCounts: Readonly<
    Record<'context' | 'provenance' | 'reference', number>
  >;
  readonly exportedAt: string;
  readonly graphId: string;
  readonly nodeCount: number;
  readonly revisionCount: number;
}

export interface ExportedGraphDocument {
  readonly document: GraphDocumentV1;
  readonly json: string;
  readonly sha256: string;
}
