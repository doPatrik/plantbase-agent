// Integrációs teszt (HF5 final review, Finding 2): igazolja, hogy két
// FÜGGETLEN store-példány — az egyik a pipeline (createDefaultChatDeps), a
// másik a backend (createBackendDeps) oldalát szimulálva — ugyanazt a
// könyvtárat használva látja egymás írásait. Ez az architektúra alapfeltétele:
// a pipeline nyitja a jegyet, a Support-nézet (backend) zárja le.

import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createEscalationStore } from './escalation-store.js';

describe('escalation-store: pipeline ↔ backend keresztfolyamat-láthatóság', () => {
  const dir = join(
    tmpdir(),
    `plantbase-escalation-integration-${randomUUID()}`,
  );

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('a "pipeline" store-ban nyitott jegyet a "backend" store látja, és fordítva a lezárást', () => {
    const pipelineStore = createEscalationStore({ dir });
    const opened = pipelineStore.open({
      question: 'Milyen növény való a fürdőszobámba?',
      maxSimilarity: 0.21,
    });

    const backendStore = createEscalationStore({ dir });
    const visibleFromBackend = backendStore.list();
    expect(visibleFromBackend).toHaveLength(1);
    expect(visibleFromBackend[0].id).toBe(opened.id);
    expect(visibleFromBackend[0].status).toBe('pending');

    backendStore.resolve(opened.id, 'Kollégánk hamarosan válaszol.');

    const visibleFromPipeline = pipelineStore.list();
    expect(visibleFromPipeline[0].id).toBe(opened.id);
    expect(visibleFromPipeline[0].status).toBe('resolved');
    expect(visibleFromPipeline[0].reply).toBe('Kollégánk hamarosan válaszol.');
  });
});
