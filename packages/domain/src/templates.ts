import type {
  ContentBlock,
  GraphSnapshot,
  TemplateBinding,
  TextContentBlock,
} from './types.js';

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u;
const MAX_RESOLVED_TEXT_LENGTH = 1024 * 1024;

export type TemplateSegment =
  | { readonly text: string; readonly type: 'text' }
  | { readonly name: string; readonly type: 'variable' };

export interface ParsedTemplate {
  readonly segments: readonly TemplateSegment[];
  readonly variables: readonly string[];
}

export class TemplateError extends Error {
  public constructor(
    public readonly code:
      | 'CYCLIC_BINDING'
      | 'INVALID_TEMPLATE'
      | 'MISSING_SOURCE_TEXT'
      | 'RESOLVED_TEXT_TOO_LARGE'
      | 'UNBOUND_VARIABLE',
    message: string,
    public readonly details: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'TemplateError';
  }
}

function parse(source: string): ParsedTemplate {
  const segments: TemplateSegment[] = [];
  const variables: string[] = [];
  let text = '';
  const flush = (): void => {
    if (text.length === 0) return;
    segments.push({ text, type: 'text' });
    text = '';
  };

  let index = 0;
  while (index < source.length) {
    if (source[index] === '\\') {
      let end = index;
      while (source[end] === '\\') end += 1;
      const count = end - index;
      if (source.slice(end, end + 2) === '{{') {
        text += '\\'.repeat(Math.floor(count / 2));
        if (count % 2 === 1) {
          text += '{{';
          index = end + 2;
          continue;
        }
        index = end;
      } else {
        text += '\\'.repeat(count);
        index = end;
        continue;
      }
    }

    if (source.slice(index, index + 2) !== '{{') {
      text += source[index] as string;
      index += 1;
      continue;
    }

    const close = source.indexOf('}}', index + 2);
    if (close === -1) {
      throw new TemplateError(
        'INVALID_TEMPLATE',
        'Template binding is missing its closing braces.',
      );
    }
    const name = source.slice(index + 2, close).trim();
    if (!VARIABLE_NAME.test(name)) {
      throw new TemplateError(
        'INVALID_TEMPLATE',
        `Template variable ${JSON.stringify(name)} is invalid.`,
        { name },
      );
    }
    flush();
    segments.push({ name, type: 'variable' });
    if (!variables.includes(name)) variables.push(name);
    index = close + 2;
  }
  flush();
  return { segments, variables };
}

export function extractTemplateVariables(source: string): readonly string[] {
  return parse(source).variables;
}

export function resolveTemplate(
  source: string,
  values: Readonly<Record<string, string>>,
): string {
  const parsed = parse(source);
  let result = '';
  for (const segment of parsed.segments) {
    if (segment.type === 'text') {
      result += segment.text;
    } else {
      const value = values[segment.name];
      if (value === undefined) {
        throw new TemplateError(
          'UNBOUND_VARIABLE',
          `Template variable ${segment.name} is not connected.`,
          { name: segment.name },
        );
      }
      // Values are opaque. In particular, braces inside a value are never
      // parsed again, which prevents accidental recursive expansion.
      result += value;
    }
    if (result.length > MAX_RESOLVED_TEXT_LENGTH) {
      throw new TemplateError(
        'RESOLVED_TEXT_TOO_LARGE',
        'Resolved template text exceeds the 1 MiB safety limit.',
      );
    }
  }
  return result;
}

function sourceText(
  graph: GraphSnapshot,
  binding: TemplateBinding,
  resolving: Set<string>,
): string {
  const sourceRevision = graph.revisions[binding.sourceRevisionId];
  const sourceBlocks = sourceRevision?.blocks ?? [];
  const selectedRaw = sourceBlocks.filter(
    (block): block is TextContentBlock =>
      block.type === 'text' &&
      (binding.sourceBlockId === null || block.id === binding.sourceBlockId),
  );
  if (resolving.has(binding.sourceRevisionId)) {
    throw new TemplateError(
      'CYCLIC_BINDING',
      'Template bindings contain a dependency cycle.',
      { revisionId: binding.sourceRevisionId },
    );
  }
  resolving.add(binding.sourceRevisionId);
  const selected = selectedRaw.map((block) =>
    resolveTextBlock(graph, block, resolving),
  );
  resolving.delete(binding.sourceRevisionId);
  if (selected.length === 0) {
    throw new TemplateError(
      'MISSING_SOURCE_TEXT',
      `Template variable ${binding.name} has no text source.`,
      { name: binding.name, sourceNodeId: binding.sourceNodeId },
    );
  }
  return selected.map((block) => block.text).join('\n\n');
}

function resolveTextBlock(
  graph: GraphSnapshot,
  block: TextContentBlock,
  resolving: Set<string>,
): TextContentBlock {
  if (block.template === undefined) return block;
  const values = Object.fromEntries(
    block.template.bindings.map((binding) => [
      binding.name,
      sourceText(graph, binding, resolving),
    ]),
  );
  return { ...block, text: resolveTemplate(block.text, values) };
}

export function resolveRevisionBlocks(
  graph: GraphSnapshot,
  revisionId: string,
): readonly ContentBlock[] {
  const revision = graph.revisions[revisionId];
  if (revision === undefined) {
    throw new TemplateError(
      'MISSING_SOURCE_TEXT',
      `Template source revision ${revisionId} is unavailable.`,
      { revisionId },
    );
  }
  return resolveSelectedRevisionBlocks(
    graph,
    revisionId,
    new Set(revision.blocks.map((block) => block.id)),
  );
}

export function resolveSelectedRevisionBlocks(
  graph: GraphSnapshot,
  revisionId: string,
  blockIds: ReadonlySet<string>,
): readonly ContentBlock[] {
  const revision = graph.revisions[revisionId];
  if (revision === undefined) {
    throw new TemplateError(
      'MISSING_SOURCE_TEXT',
      `Template source revision ${revisionId} is unavailable.`,
      { revisionId },
    );
  }
  const resolving = new Set([revisionId]);
  return revision.blocks
    .filter((block) => blockIds.has(block.id))
    .map((block) =>
      block.type === 'text' ? resolveTextBlock(graph, block, resolving) : block,
    );
}
