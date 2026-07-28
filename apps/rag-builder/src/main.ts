// Plantbase rag-builder — belépési pont (SP2).
// A build/stats parancsok a Task 6-ban kerülnek be.
import { Command } from 'commander';

const program = new Command();
program
  .name('rag-builder')
  .description(
    'Plantbase RAG builder: seed/knowledge → chunk → embedding → pgvector',
  )
  .version('1.0.0');

program.parseAsync();
