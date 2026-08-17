import type {
  CreateProviderProfileRequest,
  ProviderDescriptor,
} from '@waterlily/api-contract';
import { KeyRound, Trash2, X } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';

export interface ProviderProfileDialogProps {
  readonly onClose: () => void;
  readonly onCreate: (input: CreateProviderProfileRequest) => Promise<void>;
  readonly onRemove: (profileId: string) => Promise<void>;
  readonly profiles: readonly ProviderDescriptor[];
}

export function ProviderProfileDialog({
  onClose,
  onCreate,
  onRemove,
  profiles,
}: ProviderProfileDialogProps) {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [models, setModels] = useState('');
  const [providerType, setProviderType] =
    useState<CreateProviderProfileRequest['providerType']>('openai');
  const [saving, setSaving] = useState(false);

  const submit = async (
    event: SyntheticEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onCreate({
        apiKey: apiKey.trim().length === 0 ? null : apiKey.trim(),
        baseUrl: baseUrl.trim().length === 0 ? null : baseUrl.trim(),
        label: label.trim(),
        models: models
          .split(',')
          .map((model) => model.trim())
          .filter((model) => model.length > 0),
        providerType,
      });
      setApiKey('');
      setBaseUrl('');
      setLabel('');
      setModels('');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Profile could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop">
      <section
        aria-labelledby="provider-profile-dialog-title"
        aria-modal="true"
        className="operation-dialog provider-profile-dialog"
        role="dialog"
      >
        <header>
          <div>
            <span className="eyebrow">Local credentials</span>
            <h2 id="provider-profile-dialog-title">Provider profiles</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close dialog">
            <X aria-hidden="true" size={17} />
          </button>
        </header>
        <div className="provider-profile-list">
          {profiles.map((profile) => (
            <div key={profile.id}>
              <KeyRound aria-hidden="true" size={15} />
              <span>
                <strong>{profile.name}</strong>
                <small>
                  {profile.providerType} · {profile.source}
                </small>
              </span>
              <button
                aria-label={`Remove ${profile.name}`}
                disabled={profile.source !== 'stored' || saving}
                title={
                  profile.source === 'stored'
                    ? 'Remove local credential profile'
                    : 'Environment profiles are managed outside WaterLily'
                }
                type="button"
                onClick={() => {
                  setSaving(true);
                  setError(null);
                  void onRemove(profile.id)
                    .catch((cause: unknown) => {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : 'Profile could not be removed.',
                      );
                    })
                    .finally(() => setSaving(false));
                }}
              >
                <Trash2 aria-hidden="true" size={14} />
              </button>
            </div>
          ))}
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            Profile name
            <input
              autoFocus
              required
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Personal OpenAI"
            />
          </label>
          <label>
            Provider
            <select
              value={providerType}
              onChange={(event) => {
                setProviderType(
                  event.target
                    .value as CreateProviderProfileRequest['providerType'],
                );
              }}
            >
              <option value="openai">OpenAI Responses</option>
              <option value="deepseek">DeepSeek</option>
              <option value="openai-compatible">OpenAI-compatible</option>
            </select>
          </label>
          <label>
            API key{' '}
            {providerType === 'openai-compatible' ? (
              <span>optional</span>
            ) : null}
            <input
              autoComplete="off"
              required={providerType !== 'openai-compatible'}
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Stored only by the loopback service"
            />
          </label>
          {providerType === 'openai-compatible' ? (
            <>
              <label>
                Base URL
                <input
                  required
                  type="url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="http://127.0.0.1:11434/v1"
                />
              </label>
              <label>
                Models <span>comma separated</span>
                <input
                  required
                  value={models}
                  onChange={(event) => setModels(event.target.value)}
                  placeholder="llama3.3, qwen3"
                />
              </label>
            </>
          ) : null}
          <small>
            Secrets are written outside the repository with user-only file
            permissions and are never returned to this browser after saving.
          </small>
          {error === null ? null : <p role="alert">{error}</p>}
          <footer>
            <button type="button" onClick={onClose}>
              Close
            </button>
            <button className="button--primary" disabled={saving} type="submit">
              {saving ? 'Saving…' : 'Add profile'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
