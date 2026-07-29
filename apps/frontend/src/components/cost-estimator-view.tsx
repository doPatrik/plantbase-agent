import { useMemo, useState } from 'react';
import {
  computeStageCost,
  type CostEstimate,
  type ModelPrice,
  type StageUsageDto,
} from '@plantbase/shared';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

function formatUsd(value: number): string {
  return `${value.toFixed(6)} USD`;
}

interface PriceFieldProps {
  readonly label: string;
  readonly value: number | undefined;
  readonly onChange: (value: number) => void;
}

function PriceField({ label, value, onChange }: PriceFieldProps) {
  return (
    <label className="flex flex-col text-xs text-muted-foreground">
      {label}
      <input
        type="number"
        step="0.01"
        aria-label={label}
        className="w-20 rounded border border-input bg-background px-1 py-0.5 text-foreground"
        value={value ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/** A „Költség-becslő" fül: kérdésre lefuttatja a tudás-utat, stage-enkénti
 *  token/USD-bontást ad, szerkeszthető árakkal (élő, LLM-hívás nélküli what-if). */
export function CostEstimatorView() {
  const [query, setQuery] = useState('');
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [prices, setPrices] = useState<Record<string, ModelPrice>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEstimate() {
    const text = query.trim();
    if (!text) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/debug/cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? 'Hiba történt a becslés közben.');
      }
      const result = body as CostEstimate;
      setEstimate(result);
      setPrices(result.defaultPrices);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEstimate(null);
    } finally {
      setLoading(false);
    }
  }

  function updatePrice(
    model: string,
    field: keyof ModelPrice,
    value: number,
  ): void {
    setPrices((prev) => ({
      ...prev,
      [model]: {
        inputPerM: prev[model]?.inputPerM ?? 0,
        outputPerM: prev[model]?.outputPerM ?? 0,
        [field]: value,
      },
    }));
  }

  const total = useMemo(() => {
    if (!estimate) return 0;
    return estimate.stages.reduce(
      (sum, s) => sum + computeStageCost(s, prices[s.model]).totalUsd,
      0,
    );
  }, [estimate, prices]);

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 overflow-y-auto p-4">
      <h1 className="text-lg font-semibold">Költség-becslő</h1>
      <p className="text-sm text-muted-foreground">
        A kérdésre lefuttatja a tudás-út teljes pipeline-ját (valódi
        LLM/embedding-hívásokkal), és stage-enkénti token- és USD-bontást ad.
      </p>

      <div className="flex gap-2">
        <Textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Kérdezz a növényekről…"
          disabled={loading}
          rows={2}
        />
        <Button
          onClick={handleEstimate}
          disabled={loading || query.trim() === ''}
        >
          {loading ? 'Becslés…' : 'Becslés'}
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {estimate && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-1 pr-2">Stage</th>
                <th className="py-1 pr-2">Modell</th>
                <th className="py-1 pr-2">Input token</th>
                <th className="py-1 pr-2">Output token</th>
                <th className="py-1 pr-2">Ár</th>
                <th className="py-1">Költség</th>
              </tr>
            </thead>
            <tbody>
              {estimate.stages.map((s: StageUsageDto) => {
                const price = prices[s.model];
                const cost = computeStageCost(s, price);
                return (
                  <tr
                    key={s.stage}
                    className="border-b border-border align-top"
                  >
                    <td className="py-1 pr-2">{s.stage}</td>
                    <td className="py-1 pr-2">{s.model}</td>
                    <td className="py-1 pr-2">{s.inputTokens}</td>
                    <td className="py-1 pr-2">{s.outputTokens}</td>
                    <td className="py-1 pr-2">
                      <div className="flex gap-1">
                        <PriceField
                          label="input $/1M"
                          value={price?.inputPerM}
                          onChange={(v) => updatePrice(s.model, 'inputPerM', v)}
                        />
                        <PriceField
                          label="output $/1M"
                          value={price?.outputPerM}
                          onChange={(v) =>
                            updatePrice(s.model, 'outputPerM', v)
                          }
                        />
                      </div>
                    </td>
                    <td className="py-1">
                      {price ? formatUsd(cost.totalUsd) : 'nincs ár'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="pt-2 text-right font-medium">
                  Végösszeg:
                </td>
                <td className="pt-2 font-medium">{formatUsd(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
