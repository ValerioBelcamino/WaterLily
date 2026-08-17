import { FileJson2, X } from 'lucide-react';
import { useEffect, useState, type SyntheticEvent } from 'react';

export type OperationKind =
  'branch' | 'code' | 'group' | 'import' | 'merge' | 'split';

export type OperationSubmission =
  | {
      readonly kind: 'branch';
      readonly text: string;
      readonly title: string | null;
    }
  | {
      readonly kind: 'merge';
      readonly text: string;
      readonly title: string | null;
    }
  | {
      readonly kind: 'code';
      readonly source: string;
      readonly title: string | null;
    }
  | {
      readonly kind: 'group';
      readonly color: string;
      readonly title: string;
    }
  | {
      readonly kind: 'import';
      readonly source:
        | { readonly bytes: Uint8Array; readonly kind: 'archive' }
        | { readonly kind: 'json'; readonly text: string };
    }
  | {
      readonly kind: 'split';
      readonly parts: readonly string[];
      readonly titlePrefix: string | null;
    };

export interface OperationDialogProps {
  readonly initialText?: string;
  readonly kind: OperationKind;
  readonly onClose: () => void;
  readonly onSubmit: (submission: OperationSubmission) => Promise<void> | void;
  readonly selectedCount: number;
  readonly selectedTitle: string;
}

const LABELS: Readonly<Record<OperationKind, string>> = {
  branch: 'Branch from node',
  code: 'Add Python cell',
  group: 'Group selected nodes',
  import: 'Import WaterLily graph',
  merge: 'Merge selected branches',
  split: 'Split node into excerpts',
};

function parseSplitParts(text: string): readonly string[] {
  return text
    .split(/^\s*---\s*$/gmu)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function OperationDialog({
  kind,
  initialText = '',
  onClose,
  onSubmit,
  selectedCount,
  selectedTitle,
}: OperationDialogProps) {
  const [color, setColor] = useState('#7669a8');
  const [error, setError] = useState<string | null>(null);
  const [archive, setArchive] = useState<Uint8Array | null>(null);
  const [archiveName, setArchiveName] = useState<string | null>(null);
  const [json, setJson] = useState('');
  const [text, setText] = useState(kind === 'split' ? initialText : '');
  const [title, setTitle] = useState('');

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    globalThis.addEventListener('keydown', closeOnEscape);
    return () => {
      globalThis.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  const submit = async (
    event: SyntheticEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setError(null);
    try {
      if (kind === 'branch' || kind === 'merge') {
        if (text.trim().length === 0)
          throw new Error('Message cannot be blank.');
        await onSubmit({
          kind,
          text: text.trim(),
          title: title.trim().length === 0 ? null : title.trim(),
        });
      } else if (kind === 'code') {
        if (text.trim().length === 0)
          throw new Error('Python code cannot be blank.');
        await onSubmit({
          kind,
          source: text,
          title: title.trim().length === 0 ? null : title.trim(),
        });
      } else if (kind === 'split') {
        const parts = parseSplitParts(text);
        if (parts.length < 2)
          throw new Error(
            'Separate at least two excerpts with a line containing ---.',
          );
        await onSubmit({
          kind,
          parts,
          titlePrefix: title.trim().length === 0 ? null : title.trim(),
        });
      } else if (kind === 'group') {
        if (title.trim().length === 0)
          throw new Error('Group name cannot be blank.');
        await onSubmit({ color, kind, title: title.trim() });
      } else {
        if (archive === null && json.trim().length === 0)
          throw new Error('Paste or choose a graph document.');
        await onSubmit({
          kind,
          source:
            archive === null
              ? { kind: 'json', text: json }
              : { bytes: archive, kind: 'archive' },
        });
      }
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The operation failed.',
      );
    }
  };

  return (
    <div className="dialog-backdrop">
      <section
        aria-labelledby="operation-dialog-title"
        aria-modal="true"
        className="operation-dialog"
        role="dialog"
      >
        <header>
          <div>
            <span className="eyebrow">Graph operation</span>
            <h2 id="operation-dialog-title">{LABELS[kind]}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close dialog">
            <X aria-hidden="true" size={17} />
          </button>
        </header>
        <p className="operation-dialog__context">
          {kind === 'merge' || kind === 'group'
            ? `${String(selectedCount)} selected nodes`
            : selectedTitle}
        </p>
        <form onSubmit={(event) => void submit(event)}>
          {kind === 'branch' || kind === 'merge' ? (
            <>
              <label>
                Node title <span>optional</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={
                    kind === 'merge' ? 'Combined question' : 'Side question'
                  }
                />
              </label>
              <label>
                Message
                <textarea
                  autoFocus
                  required
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder={
                    kind === 'merge'
                      ? 'Ask a question using all selected branches…'
                      : 'Ask a follow-up from this exact revision…'
                  }
                />
              </label>
            </>
          ) : null}
          {kind === 'code' ? (
            <>
              <label>
                Cell title <span>optional</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Explore the data"
                />
              </label>
              <label>
                Python code
                <textarea
                  autoFocus
                  className="operation-dialog__code"
                  required
                  spellCheck={false}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder={'values = [1, 2, 3]\nprint(sum(values))'}
                />
              </label>
              <small>
                Cells on the selected context path replay in one fresh local
                Python process. This has your user permissions and is not a
                security sandbox.
              </small>
            </>
          ) : null}
          {kind === 'split' ? (
            <>
              <label>
                Title prefix <span>optional</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Key idea"
                />
              </label>
              <label>
                Excerpts
                <textarea
                  autoFocus
                  required
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder={
                    'First self-contained excerpt\n---\nSecond self-contained excerpt'
                  }
                />
              </label>
              <small>
                Each excerpt becomes an independent root with a provenance link
                to the exact source revision.
              </small>
            </>
          ) : null}
          {kind === 'group' ? (
            <div className="operation-dialog__group-fields">
              <label>
                Group name
                <input
                  autoFocus
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Review later"
                />
              </label>
              <label>
                Color
                <input
                  aria-label="Group color"
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                />
              </label>
            </div>
          ) : null}
          {kind === 'import' ? (
            <>
              <label className="operation-dialog__file">
                <FileJson2 aria-hidden="true" size={16} /> Choose .waterlily or
                JSON file
                <input
                  accept=".waterlily,.json,application/json,application/zip,application/octet-stream"
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file === undefined) return;
                    setError(null);
                    if (file.name.toLowerCase().endsWith('.waterlily')) {
                      void file.arrayBuffer().then(
                        (buffer) => {
                          setArchive(new Uint8Array(buffer));
                          setArchiveName(file.name);
                          setJson('');
                        },
                        () => {
                          setError('The selected file could not be read.');
                        },
                      );
                      return;
                    }
                    void file.text().then(
                      (value) => {
                        setArchive(null);
                        setArchiveName(null);
                        setJson(value);
                      },
                      () => {
                        setError('The selected file could not be read.');
                      },
                    );
                  }}
                />
              </label>
              {archiveName === null ? null : (
                <small>Ready to import {archiveName}</small>
              )}
              <label>
                Legacy graph JSON
                <textarea
                  autoFocus
                  required={archive === null}
                  disabled={archive !== null}
                  value={json}
                  onChange={(event) => {
                    setArchive(null);
                    setArchiveName(null);
                    setJson(event.target.value);
                  }}
                  placeholder="Paste waterlily/graph JSON…"
                />
              </label>
              <small>
                .waterlily archives preserve attachments, layout, groups, and
                context choices. Legacy JSON preserves the graph and layout but
                cannot contain attachments. Credentials are never imported.
              </small>
            </>
          ) : null}
          {error === null ? null : <p role="alert">{error}</p>}
          <footer>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="button--primary" type="submit">
              {kind === 'import' ? 'Validate & import' : LABELS[kind]}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
