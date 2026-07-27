-- Plantbase — pgvector kiterjesztés engedélyezése (RAG alapok, SP1).
-- Ez a szkript az /docker-entrypoint-initdb.d/-ből fut, a POSTGRES_USER (plantbase,
-- owner/superuser) jogával, CSAK az első (üres volume-os) konténer-indításkor.
-- Meglévő volume esetén a knowledge-migráció (Prisma) hozza létre ugyanezt (IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS vector;
