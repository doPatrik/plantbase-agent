// A backend valós függőség-wiringje (SP3b): a core motort és a knowledge-store-t
// köti a createApp DI-felületéhez. A trace-t a /api/chat route adja onTrace-ként.

import {
  runChat,
  createDefaultChatDeps,
  runRetrievalDebug,
  createDefaultRetrievalDebugDeps,
  getChunkStats,
  loadRagConfig,
} from '@plantbase/core';
import type { BackendDeps, HealthReport } from './app.js';

async function computeHealth(): Promise<HealthReport> {
  const anthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const openaiKey = Boolean(process.env.OPENAI_API_KEY);
  let database = false;
  try {
    await getChunkStats();
    database = true;
  } catch {
    database = false;
  }
  const status = database && anthropicKey ? 'ok' : 'degraded';
  return { status, checks: { database, anthropicKey, openaiKey } };
}

/** A valós backend-függőségek (motor + knowledge-store + health). */
export function createBackendDeps(): BackendDeps {
  const ragConfig = loadRagConfig();
  return {
    chat: (messages, onTrace) =>
      runChat(messages, createDefaultChatDeps({ onTrace })),
    retrievalDebug: (query, opts) => {
      const overrides: { topK?: number; rerankTopN?: number } = {};
      if (opts.topK !== undefined) overrides.topK = opts.topK;
      if (opts.rerankTopN !== undefined) overrides.rerankTopN = opts.rerankTopN;
      return runRetrievalDebug(
        query,
        createDefaultRetrievalDebugDeps(overrides),
      );
    },
    chunkStats: () => getChunkStats(),
    health: computeHealth,
    debug: ragConfig.debug,
  };
}
