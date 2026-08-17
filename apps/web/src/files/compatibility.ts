import type { ModelDescriptor } from '@waterlily/api-contract';
import type { AttachmentContentBlock, GraphSnapshot } from '@waterlily/domain';

export type AttachmentCompatibility = 'supported' | 'unknown' | 'unsupported';

function extension(name: string | null): string {
  if (name === null) return '';
  const separator = name.lastIndexOf('.');
  return separator === -1 ? '' : name.slice(separator + 1).toLowerCase();
}

function attachmentSize(graph: GraphSnapshot, nodeId: string): number | null {
  const node = graph.nodes[nodeId];
  if (node === undefined) return null;
  const metadata = graph.revisions[node.currentRevisionId]?.metadata.file;
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    Array.isArray(metadata)
  )
    return null;
  const size = (metadata as Readonly<Record<string, unknown>>).size;
  return typeof size === 'number' && Number.isFinite(size) ? size : null;
}

export function attachmentCompatibility(
  block: AttachmentContentBlock,
  model: ModelDescriptor | null,
  size: number | null,
): AttachmentCompatibility {
  if (model === null) return 'unknown';
  const capabilities = model.capabilities;
  if (!capabilities.nativeFiles) return 'unsupported';
  if (
    capabilities.maxFileBytes !== null &&
    (size === null || size > capabilities.maxFileBytes)
  )
    return 'unsupported';
  const mediaType = block.mediaType.toLowerCase();
  const fileExtension = extension(block.name);
  return capabilities.inputMimeTypes.includes(mediaType) ||
    capabilities.inputExtensions.includes(fileExtension)
    ? 'supported'
    : 'unsupported';
}

export function attachmentCompatibilityByNode(
  graph: GraphSnapshot,
  model: ModelDescriptor | null,
): Readonly<Record<string, AttachmentCompatibility>> {
  return Object.fromEntries(
    Object.values(graph.nodes).flatMap((node) => {
      const revision = graph.revisions[node.currentRevisionId];
      const attachments = revision?.blocks.filter(
        (block): block is AttachmentContentBlock => block.type === 'attachment',
      );
      if (attachments === undefined || attachments.length === 0) return [];
      const size = attachmentSize(graph, node.id);
      const states = attachments.map((block) =>
        attachmentCompatibility(block, model, size),
      );
      const state = states.includes('unsupported')
        ? 'unsupported'
        : states.includes('unknown')
          ? 'unknown'
          : 'supported';
      return [[node.id, state] as const];
    }),
  );
}
