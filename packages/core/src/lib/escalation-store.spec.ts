import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEscalationStore } from './escalation-store.js';

describe('createEscalationStore', () => {
  const dir = join(tmpdir(), 'plantbase-escalation-store-test');

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('open(): pending jegyet hoz létre és JSONL-sort ír', () => {
    const store = createEscalationStore({ dir, filename: 'esc.jsonl' });
    const ticket = store.open({
      question: 'Milyen növény való a fürdőszobámba?',
      maxSimilarity: 0.21,
    });

    expect(ticket.status).toBe('pending');
    expect(ticket.question).toBe('Milyen növény való a fürdőszobámba?');
    expect(ticket.maxSimilarity).toBe(0.21);
    expect(ticket.reason).toBe('low_grounding');
    expect(ticket.reply).toBeNull();
    expect(typeof ticket.id).toBe('string');
    expect(ticket.id.length).toBeGreaterThan(0);

    const lines = readFileSync(store.filePath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      type: 'opened',
      id: ticket.id,
      question: ticket.question,
    });
  });

  it('list(): a nyitott jegyeket pending státusszal adja vissza', () => {
    const store = createEscalationStore({ dir, filename: 'esc.jsonl' });
    store.open({ question: 'Első kérdés', maxSimilarity: 0.1 });
    store.open({ question: 'Második kérdés', maxSimilarity: 0.2 });

    const tickets = store.list();
    expect(tickets).toHaveLength(2);
    expect(tickets.every((t) => t.status === 'pending')).toBe(true);
  });

  it('resolve(): lezárja a jegyet, a list() resolved-ként adja vissza reply-jal', () => {
    const store = createEscalationStore({ dir, filename: 'esc.jsonl' });
    const opened = store.open({ question: 'Kérdés', maxSimilarity: 0.1 });

    const resolved = store.resolve(opened.id, 'Kollégánk hamarosan válaszol.');
    expect(resolved.status).toBe('resolved');
    expect(resolved.reply).toBe('Kollégánk hamarosan válaszol.');
    expect(resolved.resolvedAt).toEqual(expect.any(String));

    const [ticket] = store.list();
    expect(ticket.status).toBe('resolved');
    expect(ticket.reply).toBe('Kollégánk hamarosan válaszol.');
  });

  it('resolve(): ismeretlen id-ra hibát dob', () => {
    const store = createEscalationStore({ dir, filename: 'esc.jsonl' });
    expect(() => store.resolve('nincs-ilyen', 'válasz')).toThrow();
  });

  it('resolve(): már lezárt jegyre hibát dob', () => {
    const store = createEscalationStore({ dir, filename: 'esc.jsonl' });
    const opened = store.open({ question: 'Kérdés', maxSimilarity: 0.1 });
    store.resolve(opened.id, 'Első válasz');
    expect(() => store.resolve(opened.id, 'Második válasz')).toThrow();
  });

  it('list(): egy másik store-példány (ugyanaz a fájl) is látja a változást', () => {
    const storeA = createEscalationStore({ dir, filename: 'esc.jsonl' });
    const opened = storeA.open({ question: 'Kérdés', maxSimilarity: 0.1 });

    const storeB = createEscalationStore({ dir, filename: 'esc.jsonl' });
    storeB.resolve(opened.id, 'Válasz a másik store-példányból');

    expect(storeA.list()[0].status).toBe('resolved');
  });

  it('list(): üres/nemlétező fájl esetén üres tömböt ad', () => {
    const store = createEscalationStore({ dir, filename: 'nincs-ilyen.jsonl' });
    expect(store.list()).toEqual([]);
  });
});
