import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ProviderProfileDialog } from './ProviderProfileDialog';

const capabilities = {
  inputExtensions: [],
  inputMimeTypes: [],
  maxFileBytes: null,
  nativeFiles: false,
} as const;

const profiles = [
  {
    available: true,
    defaultModel: 'gpt-test',
    id: 'stored-profile',
    models: [{ capabilities, id: 'gpt-test', name: 'GPT test' }],
    name: 'Personal',
    providerType: 'openai' as const,
    source: 'stored' as const,
  },
  {
    available: true,
    defaultModel: 'local',
    id: 'environment-profile',
    models: [{ capabilities, id: 'local', name: 'Local' }],
    name: 'Environment',
    providerType: 'openai-compatible' as const,
    source: 'environment' as const,
  },
];

describe('ProviderProfileDialog', () => {
  it('creates hosted profiles, removes stored profiles, and closes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreate = vi.fn(() => Promise.resolve());
    const onRemove = vi.fn(() => Promise.resolve());
    render(
      <ProviderProfileDialog
        onClose={onClose}
        onCreate={onCreate}
        onRemove={onRemove}
        profiles={profiles}
      />,
    );

    expect(screen.getByText('Personal')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Remove Environment' }),
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Remove Personal' }));
    expect(onRemove).toHaveBeenCalledWith('stored-profile');

    await user.type(screen.getByLabelText('Profile name'), ' My OpenAI ');
    await user.type(screen.getByLabelText(/API key/), ' secret-key ');
    await user.click(screen.getByRole('button', { name: 'Add profile' }));
    expect(onCreate).toHaveBeenCalledWith({
      apiKey: 'secret-key',
      baseUrl: null,
      label: 'My OpenAI',
      models: [],
      providerType: 'openai',
    });
    expect(screen.getByLabelText('Profile name')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('collects compatible model settings and surfaces async failures', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => Promise.reject(new Error('Cannot save key')));
    const onRemove = vi.fn(() => Promise.reject(new Error('remove failed')));
    render(
      <ProviderProfileDialog
        onClose={() => undefined}
        onCreate={onCreate}
        onRemove={onRemove}
        profiles={profiles.slice(0, 1)}
      />,
    );

    await user.selectOptions(
      screen.getByLabelText('Provider'),
      'openai-compatible',
    );
    await user.type(screen.getByLabelText('Profile name'), 'Ollama');
    await user.type(
      screen.getByLabelText('Base URL'),
      'http://127.0.0.1:11434/v1',
    );
    await user.type(screen.getByLabelText(/Models/), ' qwen3, llama3 ,, ');
    await user.click(screen.getByRole('button', { name: 'Add profile' }));
    expect(onCreate).toHaveBeenCalledWith({
      apiKey: null,
      baseUrl: 'http://127.0.0.1:11434/v1',
      label: 'Ollama',
      models: ['qwen3', 'llama3'],
      providerType: 'openai-compatible',
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cannot save key',
    );

    await user.click(screen.getByRole('button', { name: 'Remove Personal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('remove failed');
  });
});
