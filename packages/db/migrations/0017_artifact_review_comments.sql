-- 0017_artifact_review_comments.sql
-- Rebuild artifact_reviews so durable review audit records can include
-- line-level "comment" decisions on databases that already applied 0016.

DROP INDEX IF EXISTS idx_artifact_reviews_artifact;

ALTER TABLE artifact_reviews RENAME TO artifact_reviews_0017_old;

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

INSERT INTO artifact_reviews (id, artifact_id, decision, reviewer_kind, reviewer_id, reason, file_path, line_number, created_at)
SELECT id, artifact_id, decision, reviewer_kind, reviewer_id, reason, file_path, line_number, created_at
FROM artifact_reviews_0017_old;

DROP TABLE artifact_reviews_0017_old;

CREATE INDEX idx_artifact_reviews_artifact ON artifact_reviews (artifact_id, created_at ASC);
