import { fireEvent, render, screen } from '@testing-library/react';
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

  it('creates a persistent editable checkpoint from the selected revisions', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <OperationDialog
        kind="checkpoint"
        onClose={() => undefined}
        onSubmit={onSubmit}
        selectedCount={2}
        selectedTitle="Ignored"
      />,
    );
    expect(screen.getByText('2 selected nodes')).toBeVisible();
    expect(
      screen.getByText(/future context starts from this editable summary/),
    ).toBeVisible();
    await user.type(screen.getByLabelText(/Node title/), ' Chapter one ');
    await user.type(
      screen.getByLabelText('Persistent summary'),
      ' Stable understanding. ',
    );
    await user.click(
      screen.getByRole('button', { name: 'Create summary checkpoint' }),
    );
    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'checkpoint',
      text: 'Stable understanding.',
      title: 'Chapter one',
    });
  });

  it.each([
    ['branch', 'Message cannot be blank.'],
    ['checkpoint', 'Checkpoint summary cannot be blank.'],
    ['code', 'Python code cannot be blank.'],
    ['group', 'Group name cannot be blank.'],
    ['import', 'Paste or choose a graph document.'],
  ] as const)('validates blank %s submissions', async (kind, message) => {
    const view = render(
      <OperationDialog
        kind={kind}
        onClose={() => undefined}
        onSubmit={() => undefined}
        selectedCount={1}
        selectedTitle="Selection"
      />,
    );
    const form = view.container.querySelector('form');
    expect(form).not.toBeNull();
    if (form !== null) fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
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
    fireEvent.change(screen.getByLabelText('Group color'), {
      target: { value: '#547a68' },
    });
    await user.click(
      screen.getByRole('button', { name: 'Group selected nodes' }),
    );
    expect(onSubmit).toHaveBeenCalledWith({
      color: '#547a68',
      kind: 'group',
      title: 'Exam review',
    });
  });

  it('submits an exact Python cell and validates blank code', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <OperationDialog
        kind="code"
        onClose={() => undefined}
        onSubmit={onSubmit}
        selectedCount={1}
        selectedTitle="Current branch"
      />,
    );
    expect(screen.getByText(/not a security sandbox/)).toBeVisible();
    await user.type(screen.getByLabelText(/Cell title/), ' Calculation ');
    await user.type(
      screen.getByLabelText('Python code'),
      'value = 40{enter}print(value + 2)',
    );
    await user.click(screen.getByRole('button', { name: 'Add Python cell' }));
    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'code',
      source: 'value = 40\nprint(value + 2)',
      title: 'Calculation',
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
    await user.upload(screen.getByLabelText(/Choose .waterlily or/), file);
    expect(
      await screen.findByDisplayValue('{"schemaVersion":2}'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Validate & import' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Unsupported graph version',
    );
  });

  it('reports browser file read failures during import', async () => {
    const user = userEvent.setup();
    render(
      <OperationDialog
        kind="import"
        onClose={() => undefined}
        onSubmit={() => undefined}
        selectedCount={0}
        selectedTitle="No selection"
      />,
    );
    const file = new File(['private'], 'graph.json', {
      type: 'application/json',
    });
    Object.defineProperty(file, 'text', {
      value: () => Promise.reject(new Error('browser detail')),
    });
    await user.upload(screen.getByLabelText(/Choose .waterlily or/), file);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'selected file could not be read',
    );
  });

  it('loads a portable WaterLily archive as binary data', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <OperationDialog
        kind="import"
        onClose={() => undefined}
        onSubmit={onSubmit}
        selectedCount={0}
        selectedTitle="No selection"
      />,
    );
    const file = new File(['archive'], 'study.waterlily', {
      type: 'application/vnd.waterlily+zip',
    });
    Object.defineProperty(file, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
    });
    await user.upload(screen.getByLabelText(/Choose .waterlily or/), file);
    expect(
      await screen.findByText(/Ready to import study.waterlily/),
    ).toBeVisible();
    expect(screen.getByLabelText('Legacy graph JSON')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Validate & import' }));
    expect(onSubmit).toHaveBeenCalledOnce();
    const submission = onSubmit.mock.calls[0]?.[0] as {
      source: { bytes: Uint8Array; kind: string };
    };
    expect(submission.source.kind).toBe('archive');
    expect(Array.from(submission.source.bytes)).toEqual([1, 2, 3]);
  });

  it('reports portable archive read failures', async () => {
    const user = userEvent.setup();
    render(
      <OperationDialog
        kind="import"
        onClose={() => undefined}
        onSubmit={() => undefined}
        selectedCount={0}
        selectedTitle="No selection"
      />,
    );
    const file = new File(['bad'], 'bad.waterlily');
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.reject(new Error('browser detail')),
    });
    await user.upload(screen.getByLabelText(/Choose .waterlily or/), file);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'selected file could not be read',
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
