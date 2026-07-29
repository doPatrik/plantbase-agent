// Plantbase backend — belépési pont (SP3b). Felépíti a valós függőségeket,
// példányosítja a createApp-ot, a PORT-on figyel, és jelre rendezetten leáll
// (pg-poolok zárása). A .env-et a core findUp-pal találja meg.

import { closePool, closeKnowledgePool } from '@plantbase/core';
import { z } from 'zod';
import { createApp } from './lib/app.js';
import { createBackendDeps } from './lib/deps.js';

const portSchema = z.coerce.number().int().positive().default(3000);

function resolvePort(): number {
  const parsed = portSchema.safeParse(process.env.PORT);
  return parsed.success ? parsed.data : 3000;
}

function main(): void {
  const app = createApp(createBackendDeps());
  const port = resolvePort();
  const server = app.listen(port, () => {
    console.error(`Plantbase backend fut: http://localhost:${port}`);
  });

  const shutdown = (signal: string): void => {
    console.error(`\n${signal} — leállás...`);
    server.close(() => {
      void Promise.allSettled([closePool(), closeKnowledgePool()]).then(() => {
        process.exit(0);
      });
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
