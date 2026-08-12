import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { sampleGraph } from '../sampleGraph';
import { FocusView } from './FocusView';

describe('FocusView', () => {
  it('asks for a head when none is selected', () => {
    render(
      <FocusView
        graph={sampleGraph}
        headNodeId={null}
        onSelectNode={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Choose a head to read' }),
    ).toBeVisible();
  });

  it('renders the selected causal thread and makes each node selectable', async () => {
    const user = userEvent.setup();
    const onSelectNode = vi.fn();
    render(
      <FocusView
        graph={sampleGraph}
        headNodeId="node-synthesis"
        onSelectNode={onSelectNode}
      />,
    );

    expect(
      screen.getByText('6 context nodes · shared ancestry appears once'),
    ).toBeVisible();
    expect(screen.getAllByText('Mechanism overview')).toHaveLength(1);
    expect(screen.queryByText('Dam analogy')).not.toBeInTheDocument();
    expect(screen.getByLabelText('End of selected path')).toBeVisible();

    await user.click(screen.getByRole('button', { name: /Core question/ }));
    expect(onSelectNode).toHaveBeenCalledWith('node-question');
  });
});
