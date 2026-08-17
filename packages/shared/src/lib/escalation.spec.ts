import { describe, it, expect } from 'vitest';
import {
  escalationTicketSchema,
  escalationListSchema,
  escalationResolveRequestSchema,
} from './escalation.js';

const pendingTicket = {
  id: 'a1',
  createdAt: '2026-08-17T10:00:00.000Z',
  question: 'Milyen növény való a fürdőszobámba?',
  maxSimilarity: 0.21,
  reason: 'low_grounding',
  status: 'pending',
  reply: null,
  resolvedAt: null,
};

describe('escalationTicketSchema', () => {
  it('elfogadja a pending jegyet', () => {
    expect(escalationTicketSchema.safeParse(pendingTicket).success).toBe(true);
  });

  it('elfogadja a resolved jegyet (reply/resolvedAt kitöltve)', () => {
    const resolved = {
      ...pendingTicket,
      status: 'resolved',
      reply: 'A fürdőszobába egy páratűrő papradicsom illik.',
      resolvedAt: '2026-08-17T10:05:00.000Z',
    };
    expect(escalationTicketSchema.safeParse(resolved).success).toBe(true);
  });

  it('elutasítja az ismeretlen reason értéket', () => {
    const invalid = { ...pendingTicket, reason: 'order_issue' };
    expect(escalationTicketSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('escalationListSchema', () => {
  it('elfogadja a jegyek tömbjét', () => {
    expect(escalationListSchema.safeParse([pendingTicket]).success).toBe(true);
  });
});

describe('escalationResolveRequestSchema', () => {
  it('elfogadja a nem üres reply-t', () => {
    const parsed = escalationResolveRequestSchema.safeParse({
      reply: 'Kollégánk hamarosan válaszol.',
    });
    expect(parsed.success).toBe(true);
  });

  it('elutasítja az üres reply-t', () => {
    const parsed = escalationResolveRequestSchema.safeParse({ reply: '' });
    expect(parsed.success).toBe(false);
  });
});
