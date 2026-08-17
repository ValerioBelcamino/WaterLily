import type { GraphSnapshot } from '@waterlily/domain';
import {
  exportGraphDocument,
  type ExportedWaterLilyArchive,
  type GraphViewState,
} from '@waterlily/interchange';

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
    exporter: { name: 'WaterLily', version: '0.0.0' },
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

export function downloadWaterLilyArchive(
  archive: ExportedWaterLilyArchive,
  graphId: string,
): void {
  const url = URL.createObjectURL(
    new Blob([archive.bytes.slice().buffer], {
      type: 'application/vnd.waterlily+zip',
    }),
  );
  try {
    const anchor = document.createElement('a');
    anchor.download = `${graphId}.waterlily`;
    anchor.href = url;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
