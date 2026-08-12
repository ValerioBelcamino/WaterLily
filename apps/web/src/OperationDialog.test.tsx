import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { OperationDialog } from './OperationDialog';

describe('OperationDialog', () => {
  it('submits a trimmed branch message and closes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(
      <OperationDialog
        kind="branch"
        onClose={onClose}
        onSubmit={onSubmit}
        selectedCount={1}
        selectedTitle="Mechanism overview"
      />,
    );

    await user.type(screen.getByLabelText(/Node title/), ' Side path ');
    await user.type(screen.getByLabelText('Message'), ' Why oxygen? ');
    await user.click(screen.getByRole('button', { name: 'Branch from node' }));

    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'branch',
      text: 'Why oxygen?',
      title: 'Side path',
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('validates splits and keeps the dialog open after a failed operation', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error('Identifier collision'))
      .mockResolvedValueOnce(undefined);
    render(
      <OperationDialog
        kind="split"
        onClose={onClose}
        onSubmit={onSubmit}
        selectedCount={1}
        selectedTitle="Mechanism overview"
      />,
    );

    await user.type(screen.getByLabelText('Excerpts'), 'Only one excerpt');
    await user.click(
      screen.getByRole('button', { name: 'Split node into excerpts' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'at least two excerpts',
    );
    expect(onSubmit).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('Excerpts'));
    await user.type(
      screen.getByLabelText('Excerpts'),
      ' First idea \n---\n Second idea ',
    );
    await user.click(
      screen.getByRole('button', { name: 'Split node into excerpts' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Identifier collision',
    );
    expect(onClose).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', { name: 'Split node into excerpts' }),
    );
    expect(onSubmit).toHaveBeenLastCalledWith({
      kind: 'split',
      parts: ['First idea', 'Second idea'],
      titlePrefix: null,
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('submits group details and reports selected node count', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <OperationDialog
        kind="group"
        onClose={() => undefined}
        onSubmit={onSubmit}
        selectedCount={3}
        selectedTitle="Ignored"
      />,
    );

    expect(screen.getByText('3 selected nodes')).toBeVisible();
    await user.type(screen.getByLabelText('Group name'), 'Exam review');
    await user.click(
      screen.getByRole('button', { name: 'Group selected nodes' }),
    );
    expect(onSubmit).toHaveBeenCalledWith({
      color: '#7669a8',
      kind: 'group',
      title: 'Exam review',
    });
  });

  it('loads an import file and surfaces importer errors', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() => {
      throw new Error('Unsupported graph version');
    });
    render(
      <OperationDialog
        kind="import"
        onClose={() => undefined}
        onSubmit={onSubmit}
        selectedCount={0}
        selectedTitle="No selection"
      />,
    );
    const file = new File(['ignored'], 'graph.json', {
      type: 'application/json',
    });
    Object.defineProperty(file, 'text', {
      value: vi.fn().mockResolvedValue('{"schemaVersion":2}'),
    });
    await user.upload(screen.getByLabelText(/Choose JSON file/), file);
    expect(
      await screen.findByDisplayValue('{"schemaVersion":2}'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Validate & import' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Unsupported graph version',
    );
  });

  it('closes with Escape and the close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <OperationDialog
        kind="merge"
        onClose={onClose}
        onSubmit={() => undefined}
        selectedCount={2}
        selectedTitle="Two heads"
      />,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();

    rerender(
      <OperationDialog
        kind="merge"
        onClose={onClose}
        onSubmit={() => undefined}
        selectedCount={2}
        selectedTitle="Two heads"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
