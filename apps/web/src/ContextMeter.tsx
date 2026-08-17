import { Gauge } from 'lucide-react';
import type { ContextMeterState } from './useContextMeter';

function formatTokens(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    value,
  );
}

export function ContextMeter({ state }: { readonly state: ContextMeterState }) {
  if (state.status === 'idle') return null;
  const fraction =
    state.estimatedTokens === null || state.budgetTokens === null
      ? 0
      : Math.min(1, state.estimatedTokens / state.budgetTokens);
  const level =
    state.error !== null || state.overflow
      ? 'danger'
      : fraction >= 0.9
        ? 'warning'
        : 'safe';
  return (
    <section className={`context-meter context-meter--${level}`}>
      <header>
        <span>
          <Gauge aria-hidden="true" size={15} /> Context meter
        </span>
        <strong>
          {state.status === 'estimating'
            ? 'Estimating…'
            : state.error !== null
              ? 'Incomplete'
              : `~${formatTokens(state.estimatedTokens ?? 0)} tokens`}
        </strong>
      </header>
      {state.budgetTokens === null ? null : (
        <div
          aria-label={`${String(Math.round(fraction * 100))}% of available input budget`}
          className="context-meter__track"
          role="meter"
          aria-valuemax={state.budgetTokens}
          aria-valuemin={0}
          aria-valuenow={state.estimatedTokens ?? 0}
        >
          <span style={{ width: `${String(fraction * 100)}%` }} />
        </div>
      )}
      {state.error === null ? (
        <p>
          {state.budgetTokens === null
            ? 'Approximate text count · model limit unknown'
            : `${formatTokens(state.estimatedTokens ?? 0)} / ${formatTokens(state.budgetTokens)} input budget · ${formatTokens(state.outputReserveTokens)} reserved for output`}
          {state.attachmentCount === 0
            ? ''
            : ` · ${String(state.attachmentCount)} native ${state.attachmentCount === 1 ? 'file' : 'files'} not tokenized`}
        </p>
      ) : (
        <p role="alert">{state.error}</p>
      )}
      {state.breakdown.length === 0 ? null : (
        <details>
          <summary>Per-node estimate</summary>
          <ol>
            {state.breakdown.map((item, index) => (
              <li key={`${item.nodeId}:${String(index)}`}>
                <span>{item.title}</span>
                <strong>~{formatTokens(item.tokens)}</strong>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
