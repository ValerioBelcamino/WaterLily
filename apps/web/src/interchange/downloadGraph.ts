import type { GraphSnapshot } from '@llm-graph/domain';
import {
  exportGraphDocument,
  type GraphViewState,
} from '@llm-graph/interchange';

export interface DownloadGraphInput {
  readonly exportedAt: string;
  readonly graph: GraphSnapshot;
  readonly view: GraphViewState;
}

export async function downloadGraph(
  input: DownloadGraphInput,
): Promise<string> {
  const exported = await exportGraphDocument({
    exportedAt: input.exportedAt,
    exporter: { name: 'LLM Graph Workbench', version: '0.0.0' },
    graph: input.graph,
    view: input.view,
  });
  const url = URL.createObjectURL(
    new Blob([exported.json], { type: 'application/json' }),
  );
  try {
    const anchor = document.createElement('a');
    anchor.download = `${input.graph.id}.llm-graph.json`;
    anchor.href = url;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
  return exported.sha256;
}
