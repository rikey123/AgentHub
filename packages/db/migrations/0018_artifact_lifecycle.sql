-- 0018_artifact_lifecycle.sql
-- Mature artifact review and lifecycle fields.

ALTER TABLE artifacts ADD COLUMN archived_at INTEGER;
ALTER TABLE artifacts ADD COLUMN deleted_at INTEGER;

ALTER TABLE artifact_files ADD COLUMN old_path TEXT;
ALTER TABLE artifact_files ADD COLUMN binary INTEGER NOT NULL DEFAULT 0;
ALTER TABLE artifact_files ADD COLUMN no_newline_at_end INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS idx_artifact_reviews_artifact;

ALTER TABLE artifact_reviews RENAME TO artifact_reviews_0018_old;

CREATE TABLE artifact_reviews (
  id            TEXT PRIMARY KEY,
  artifact_id   TEXT NOT NULL,
  decision      TEXT NOT NULL CHECK (decision IN ('reviewing', 'accepted', 'applied', 'rejected', 'failed', 'conflict', 'discarded', 'comment')),
  reviewer_kind TEXT NOT NULL,
  reviewer_id   TEXT NOT NULL,
  reason        TEXT,
  file_path     TEXT,
  line_number   INTEGER,
  side          TEXT CHECK (side IN ('old', 'new')),
  line_start    INTEGER,
  line_end      INTEGER,
  status        TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'deleted')) DEFAULT 'open',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER,
  resolved_at   INTEGER,
  deleted_at    INTEGER
);

INSERT INTO artifact_reviews (id, artifact_id, decision, reviewer_kind, reviewer_id, reason, file_path, line_number, side, line_start, line_end, status, created_at, updated_at, resolved_at, deleted_at)
SELECT id, artifact_id, decision, reviewer_kind, reviewer_id, reason, file_path, line_number, NULL, line_number, line_number, 'open', created_at, NULL, NULL, NULL
FROM artifact_reviews_0018_old;

DROP TABLE artifact_reviews_0018_old;

CREATE INDEX idx_artifact_reviews_artifact ON artifact_reviews (artifact_id, created_at ASC);
CREATE INDEX idx_artifact_reviews_status ON artifact_reviews (artifact_id, status, created_at ASC);
