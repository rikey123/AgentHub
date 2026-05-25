# Attachments Orphan Schema Caveat

Observed during §0.1 V0.5 migration work: the existing `attachments` table defines `message_id TEXT NOT NULL` in `packages/db/migrations/0002_messages.sql`, and a fresh in-memory migration check confirmed `PRAGMA table_info(attachments)` reports `message_id.notnull = 1`.

The `0012_v05.sql` migration intentionally does not alter this because the V0.5 migration plan only adds the listed columns/indexes. If orphan attachment support is required later, it needs an explicit schema change outside §0.1.
