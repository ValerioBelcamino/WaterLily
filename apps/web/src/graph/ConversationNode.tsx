import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  Bot,
  FileOutput,
  FileText,
  Lightbulb,
  SquareTerminal,
  UserRound,
  Wrench,
} from 'lucide-react';

import {
  CONTEXT_TARGET_HANDLE,
  templateBindingHandleId,
  TEXT_OUTPUT_HANDLE,
  type ConversationFlowNode,
} from './graphViewModel';

const roleIcons = {
  assistant: Bot,
  system: Wrench,
  tool: Wrench,
  user: UserRound,
} as const;

const kindIcons = {
  code: SquareTerminal,
  execution: FileOutput,
} as const;

export function ConversationNode({
  data,
  selected,
}: NodeProps<ConversationFlowNode>) {
  const KindIcon = (kindIcons as Partial<Record<string, typeof FileText>>)[
    data.kind
  ];
  const Icon =
    data.role === null ? (KindIcon ?? FileText) : roleIcons[data.role];
  const category = data.role ?? data.kind;

  return (
    <article
      aria-label={`${data.title}, ${category}${data.flowState === 'active' ? ', active model context' : ''}`}
      className={`conversation-node conversation-node--${category}${selected ? ' is-selected' : ''}${data.contextMode === 'excluded' ? ' is-context-excluded' : ''}${data.attachmentCompatibility === 'unsupported' ? ' is-attachment-incompatible' : ''} is-flow-${data.flowState}${data.flowState === 'active' && data.flowMode !== null ? ` is-flow-${data.flowMode}` : ''}`}
      data-flow-state={data.flowState}
    >
      <Handle
        className="conversation-node__handle"
        id={CONTEXT_TARGET_HANDLE}
        isConnectable={false}
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
      {data.templateVariables.length === 0 ? null : (
        <div
          className="conversation-node__variables"
          aria-label="Template inputs"
        >
          {data.templateVariables.map((variable) => (
            <div
              className={
                variable.boundSourceNodeId === null ? 'is-unbound' : 'is-bound'
              }
              key={`${variable.blockId}:${variable.name}`}
            >
              <Handle
                aria-label={`Connect ${variable.name}`}
                className="conversation-node__variable-handle"
                id={templateBindingHandleId(variable.blockId, variable.name)}
                position={Position.Left}
                type="target"
              />
              <code>{`{{${variable.name}}}`}</code>
              <span>
                {variable.boundSourceNodeId === null ? 'unbound' : 'connected'}
              </span>
            </div>
          ))}
        </div>
      )}
      <footer>
        <span>
          {data.attachmentCompatibility === 'unsupported'
            ? 'unsupported file'
            : data.flowState === 'active'
              ? data.flowMode === 'running'
                ? 'running context'
                : 'selected context'
              : data.contextMode === 'excluded'
                ? 'context off'
                : data.kind}
        </span>
        <span aria-hidden="true">↗</span>
      </footer>
      <Handle
        aria-label="Text output"
        className="conversation-node__handle conversation-node__handle--output"
        id={TEXT_OUTPUT_HANDLE}
        position={Position.Right}
        type="source"
      />
    </article>
  );
}
