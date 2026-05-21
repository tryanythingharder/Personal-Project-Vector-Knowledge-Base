# PostgreSQL + pgvector Migration Plan

## Goal

Move Kortex from the current SQLite-first persistence model to PostgreSQL for transactional data, with `pgvector` handling vector similarity inside the same database.

## Recommended rollout

1. Keep the current production path on `SQLite + Qdrant`.
2. Introduce PostgreSQL for metadata and history first.
3. Add `pgvector` only after the PostgreSQL schema is stable.
4. Run dual-write verification in a staging environment before switching retrieval traffic.

## Current data domains

- `projects`: RAG settings, retrieval defaults, embedding and rerank model bindings
- `documents`: document lifecycle, versioning, checksum, indexing status
- `chunks`: chunk text, metadata, vector payload, section offsets
- `model_configs`: provider configuration and encrypted keys
- `model_presets`: packaged chat/runtime presets
- `conversations`, `messages`, `model_usage`, `rag_debug_logs`
- `eval_cases`, `eval_runs`, `message_feedback`, `system_events`

## PostgreSQL target mapping

- Keep every current table as a relational table in PostgreSQL.
- Convert integer primary keys to `BIGSERIAL` if future scale is expected.
- Replace `TEXT` JSON blobs gradually with `JSONB`:
  - `documents.metadata_json`
  - `chunks.metadata_json`
  - `projects.metadata_filter_json`
  - `model_presets.metadata_filter_json`
  - `model_presets.tools_json`
  - `messages.citations_json`
  - `eval_runs.citations_json`
  - `eval_runs.model_snapshot_json`
  - `system_events.detail_json`
- Add `created_at` and `updated_at` indexes where list views depend on time ordering.

## pgvector schema sketch

```sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE chunks
ADD COLUMN embedding vector(384);

CREATE INDEX idx_chunks_embedding_cosine
ON chunks
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

Notes:

- `384` matches the current local hash embedding size. If you standardize on a hosted embedding model, use that model's true dimension instead.
- Keep `vector_model_id` so mixed-model historical data can still be filtered or reindexed.

## Data migration steps

1. Export SQLite tables in dependency order:
   - projects
   - model_configs
   - model_presets
   - documents
   - chunks
   - conversations
   - messages
   - model_usage
   - rag_debug_logs
   - eval_cases
   - eval_runs
   - message_feedback
   - system_events
2. Normalize JSON text fields during import:
   - invalid JSON becomes `{}` or `[]` based on field type
3. Backfill `chunks.embedding` from:
   - parsed `vector_json`, or
   - re-embedding if dimensions changed
4. Validate row counts and checksum totals.
5. Run retrieval parity tests with the built-in eval suite.

## Application changes required

- Add `DATABASE_URL` support in the backend.
- Split the database access layer so SQLite and PostgreSQL share one domain API.
- Move SQL that depends on SQLite quirks:
  - `AUTOINCREMENT`
  - `PRAGMA`
  - permissive `GROUP BY`
- Use parameterized JSONB filters for metadata filtering.
- Add a retrieval adapter:
  - `sqlite`
  - `qdrant`
  - `pgvector`

## Suggested production cutover

1. Stand up PostgreSQL and run schema migrations.
2. Import a fresh snapshot from SQLite.
3. Replay a subset of recent chats and eval cases.
4. Compare:
   - retrieval hit quality
   - latency
   - token accounting
   - preset application behavior
5. Switch backend reads to PostgreSQL in staging.
6. Switch writes.
7. Keep SQLite backup export enabled for rollback during the first release.

## Rollback plan

- Keep the latest SQLite backup zip from `/api/admin/backup`.
- Keep Qdrant snapshots if Qdrant remains the vector backend during transition.
- Do not remove `vector_json` until pgvector parity is confirmed.

## Recommendation

For your next production step, prefer:

- short term: `SQLite + Qdrant + backup/restore`
- medium term: `PostgreSQL + Qdrant`
- later unified path: `PostgreSQL + pgvector`

That path keeps the current code changes usable now, while avoiding a risky full storage rewrite before your product behavior is stable.
