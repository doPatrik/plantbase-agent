import { useEffect, useState } from 'react';
import { escalationListSchema, type EscalationTicket } from '@plantbase/shared';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

async function fetchEscalations(): Promise<EscalationTicket[]> {
  const res = await fetch('/api/escalations');
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? 'Hiba történt az eszkalációk betöltésekor.');
  }
  const parsed = escalationListSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error('Érvénytelen válasz a szervertől.');
  }
  return parsed.data;
}

/** A "Support" fül: a guardrail-bizonytalan kérdésekből nyílt eszkalációs
 *  jegyek sora, emberi jóváhagyással (draft válasz + "Jóváhagyás és válasz"). */
export function EscalationQueueView() {
  const [tickets, setTickets] = useState<EscalationTicket[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload(): Promise<void> {
    try {
      setTickets(await fetchEscalations());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleResolve(id: string): Promise<void> {
    const reply = (drafts[id] ?? '').trim();
    if (!reply) return;
    try {
      const res = await fetch(`/api/escalations/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? 'Hiba történt a jóváhagyás közben.');
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const pending = tickets.filter((t) => t.status === 'pending');
  const resolved = tickets.filter((t) => t.status === 'resolved');

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 overflow-y-auto p-4">
      <h1 className="text-lg font-semibold">Support — eszkalációs jegyek</h1>
      <p className="text-sm text-muted-foreground">
        Ide kerülnek azok a kérdések, amikre az agent bizonytalan volt és nem
        válaszolt automatikusan. Egy ember fogalmazza meg és hagyja jóvá a
        választ, mielőtt az kimenne az ügyfélnek.
      </p>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Betöltés…</p>
      ) : (
        <>
          <section>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">
              Függőben ({pending.length})
            </h2>
            {pending.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nincs függőben lévő jegy.
              </p>
            )}
            <ul className="flex flex-col gap-3">
              {pending.map((ticket) => (
                <li
                  key={ticket.id}
                  className="rounded-md border border-border p-3"
                >
                  <p className="font-medium">{ticket.question}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(ticket.createdAt).toLocaleString('hu-HU')} ·
                    hasonlóság: {ticket.maxSimilarity.toFixed(2)}
                  </p>
                  <Textarea
                    className="mt-2"
                    value={drafts[ticket.id] ?? ''}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [ticket.id]: e.target.value,
                      }))
                    }
                    placeholder="Írd meg a választ…"
                    rows={2}
                  />
                  <Button
                    className="mt-2"
                    onClick={() => handleResolve(ticket.id)}
                    disabled={(drafts[ticket.id] ?? '').trim() === ''}
                  >
                    Jóváhagyás és válasz
                  </Button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">
              Megválaszolva ({resolved.length})
            </h2>
            <ul className="flex flex-col gap-3">
              {resolved.map((ticket) => (
                <li
                  key={ticket.id}
                  className="rounded-md border border-border p-3 opacity-70"
                >
                  <p className="font-medium">{ticket.question}</p>
                  <p className="mt-1 text-sm">{ticket.reply}</p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
