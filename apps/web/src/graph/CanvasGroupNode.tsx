import type { NodeProps } from '@xyflow/react';
import { Boxes } from 'lucide-react';

import type { GroupFlowNode } from './graphViewModel';

export function CanvasGroupNode({ data }: NodeProps<GroupFlowNode>) {
  return (
    <div className="canvas-group__label" style={{ color: data.color }}>
      <Boxes aria-hidden="true" size={14} />
      <span>{data.title}</span>
      <small>{data.memberNodeIds.length}</small>
    </div>
  );
}
