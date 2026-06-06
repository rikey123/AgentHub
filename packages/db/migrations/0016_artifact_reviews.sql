-- 0016_artifact_reviews.sql
-- Durable artifact review/audit decisions.

CREATE TABLE artifact_reviews (
  id            TEXT PRIMARY KEY,
  artifact_id   TEXT NOT NULL,
  decision      TEXT NOT NULL CHECK (decision IN ('reviewing', 'accepted', 'applied', 'rejected', 'failed', 'conflict', 'discarded', 'comment')),
  reviewer_kind TEXT NOT NULL,
  reviewer_id   TEXT NOT NULL,
  reason        TEXT,
  file_path     TEXT,
  line_number   INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_artifact_reviews_artifact ON artifact_reviews (artifact_id, created_at ASC);
