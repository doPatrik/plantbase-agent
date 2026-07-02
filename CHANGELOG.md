# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-02

First stable release. Plantbase is a CLI AI-agent that turns natural-language
questions into SQL over the plant catalog (`products`), runs it on a read-only
connection, and answers in Hungarian.

### Added

- **Agent core** (`@plantbase/core`): hand-written tool-use loop
  (`client.messages.create` + `stop_reason: 'tool_use'`), no SDK helper or agent
  framework.
- **`runSql` tool**: executes queries via `pg` on the read-only connection
  (`DATABASE_URL_READONLY`). SELECT-only enforced by defence-in-depth — the DB
  read-only role plus a code-level `assertSelectOnly` guard.
- **`listCategories` tool**: read-only helper to list catalog categories, wired
  into the tool-use loop and dispatched through a tool registry (see ADR-0001).
- **System prompt**: XML-tagged builder with schema context, tuned for cost and
  answer quality.
- **CLI** (`@plantbase/cli`): `ask <question>` command plus interactive mode
  (commander + `node:readline`). `--show-prompt` prints the full system prompt
  and message array for transparency.
- **Database** (`@plantbase/db`): Prisma `products` schema, initial migration,
  and seed of 30 plants. Prisma is used only for schema/migration/seed on the
  RW connection.
- **JSONL logging**: every interaction is written to `logs/<timestamp>.jsonl`
  at the workspace root.
- **Config**: env loader validated with zod; secrets live only in the root
  `.env`, located from anywhere via `findUp`.
- **Local infra**: docker-compose Postgres with separate RW (`plantbase`) and
  RO (`plantbase_ro`) roles.
- **Docs**: root README, `CONTEXT.md`, `CLAUDE.md` agent guide, ADR-0001
  (tool-registry dispatch), and a 5-person-office ROI breakdown.

[1.0.0]: https://github.com/doPatrik/plantbase-agent/releases/tag/v1.0.0
