import { render, screen } from '@testing-library/react';
import type { NodeProps } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@xyflow/react', () => ({
  Handle: ({ 'aria-label': label }: { readonly 'aria-label'?: string }) => (
    <span aria-label={label} />
  ),
  Position: { Left: 'left', Right: 'right' },
}));

import { ConversationNode } from './ConversationNode';
import type {
  ConversationFlowNode,
  ConversationNodeData,
} from './graphViewModel';

function props(
  data: ConversationNodeData,
  selected = false,
): NodeProps<ConversationFlowNode> {
  return { data, selected } as NodeProps<ConversationFlowNode>;
}

const base: ConversationNodeData = {
  attachmentCompatibility: null,
  contextMode: 'full',
  flowMode: null,
  flowState: 'idle',
  kind: 'message',
  preview: 'Preview',
  role: 'assistant',
  templateVariables: [],
  title: 'Answer',
};

describe('ConversationNode', () => {
  it('renders every flow, compatibility, and variable-pin state', () => {
    const view = render(<ConversationNode {...props(base)} />);
    expect(
      screen.getByRole('article', { name: 'Answer, assistant' }),
    ).toHaveTextContent('message');

    view.rerender(
      <ConversationNode
        {...props(
          {
            ...base,
            attachmentCompatibility: 'unsupported',
            contextMode: 'excluded',
            flowMode: 'running',
            flowState: 'active',
            kind: 'summary',
            role: null,
            templateVariables: [
              {
                blockId: 'block-summary',
                boundSourceNodeId: null,
                name: 'unbound',
              },
              {
                blockId: 'block-summary',
                boundSourceNodeId: 'node-source',
                name: 'bound',
              },
            ],
            title: 'Summary',
          },
          true,
        )}
      />,
    );
    const summary = screen.getByRole('article', {
      name: 'Summary, summary, active model context',
    });
    expect(summary).toHaveClass(
      'is-selected',
      'is-context-excluded',
      'is-attachment-incompatible',
      'is-flow-running',
    );
    expect(screen.getByLabelText('Synthesis')).toBeVisible();
    expect(screen.getByText('unbound')).toBeVisible();
    expect(screen.getByText('connected')).toBeVisible();
    expect(summary).toHaveTextContent('unsupported file');

    view.rerender(
      <ConversationNode
        {...props({
          ...base,
          flowMode: 'running',
          flowState: 'active',
          kind: 'code',
          role: null,
        })}
      />,
    );
    expect(screen.getByText('running context')).toBeVisible();

    view.rerender(
      <ConversationNode
        {...props({
          ...base,
          contextMode: 'excluded',
          role: null,
        })}
      />,
    );
    expect(screen.getByText('context off')).toBeVisible();
  });
});
