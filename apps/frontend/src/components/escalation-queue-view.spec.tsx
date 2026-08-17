import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EscalationQueueView } from './escalation-queue-view';
import type { EscalationTicket } from '@plantbase/shared';

const pendingTicket: EscalationTicket = {
  id: 't1',
  createdAt: '2026-08-17T10:00:00.000Z',
  question: 'Milyen növény való a fürdőszobámba?',
  maxSimilarity: 0.21,
  reason: 'low_grounding',
  status: 'pending',
  reply: null,
  resolvedAt: null,
};

const resolvedTicket: EscalationTicket = {
  ...pendingTicket,
  id: 't1',
  status: 'resolved',
  reply: 'A fürdőszobába egy páratűrő papradicsom illik.',
  resolvedAt: '2026-08-17T10:05:00.000Z',
};

describe('EscalationQueueView', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/escalations') {
        return { ok: true, json: async () => [pendingTicket] } as Response;
      }
      throw new Error(`nem várt fetch: ${url}`);
    }) as unknown as typeof fetch;
  });

  it('betöltéskor lekéri és megjeleníti a függőben lévő jegyet', async () => {
    render(<EscalationQueueView />);
    await waitFor(() =>
      expect(
        screen.getByText('Milyen növény való a fürdőszobámba?'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/Függőben \(1\)/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/escalations');
  });

  it('jóváhagyás gombra elküldi a választ, majd újratölti a listát resolved státusszal', async () => {
    let wasResolved = false;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/escalations/t1/resolve') {
        wasResolved = true;
        return { ok: true, json: async () => resolvedTicket } as Response;
      }
      if (url === '/api/escalations') {
        return {
          ok: true,
          json: async () => [wasResolved ? resolvedTicket : pendingTicket],
        } as Response;
      }
      throw new Error(`nem várt fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(<EscalationQueueView />);
    await waitFor(() =>
      expect(
        screen.getByText('Milyen növény való a fürdőszobámba?'),
      ).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText(/Írd meg a választ/i), {
      target: { value: 'A fürdőszobába egy páratűrő papradicsom illik.' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Jóváhagyás és válasz/i }),
    );

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/escalations/t1/resolve',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText(/Megválaszolva \(1\)/)).toBeInTheDocument(),
    );
    expect(
      screen.getByText('A fürdőszobába egy páratűrő papradicsom illik.'),
    ).toBeInTheDocument();
  });

  it('hibaüzenetet mutat, ha a lista-válasz nem érvényes', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [{ id: 't1' }],
    })) as unknown as typeof fetch;
    render(<EscalationQueueView />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
