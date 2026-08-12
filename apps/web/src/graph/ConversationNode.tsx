import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Bot, FileText, Lightbulb, UserRound, Wrench } from 'lucide-react';

import type { ConversationFlowNode } from './graphViewModel';

const roleIcons = {
  assistant: Bot,
  system: Wrench,
  tool: Wrench,
  user: UserRound,
} as const;

export function ConversationNode({
  data,
  selected,
}: NodeProps<ConversationFlowNode>) {
  const Icon = data.role === null ? FileText : roleIcons[data.role];
  const category = data.role ?? data.kind;

  return (
    <article
      aria-label={`${data.title}, ${category}`}
      className={`conversation-node conversation-node--${category}${selected ? ' is-selected' : ''}${data.contextMode === 'excluded' ? ' is-context-excluded' : ''}`}
    >
      <Handle
        className="conversation-node__handle"
        position={Position.Left}
        type="target"
      />
      <header className="conversation-node__header">
        <span className="conversation-node__icon" aria-hidden="true">
          <Icon size={15} strokeWidth={2} />
        </span>
        <span className="conversation-node__category">{category}</span>
        {data.kind === 'summary' ? (
          <Lightbulb
            className="conversation-node__signal"
            size={14}
            aria-label="Synthesis"
          />
        ) : null}
      </header>
      <h2>{data.title}</h2>
      <p>{data.preview}</p>
      <footer>
        <span>
          {data.contextMode === 'excluded' ? 'context off' : data.kind}
        </span>
        <span aria-hidden="true">↗</span>
      </footer>
      <Handle
        className="conversation-node__handle"
        position={Position.Right}
        type="source"
      />
    </article>
  );
}
