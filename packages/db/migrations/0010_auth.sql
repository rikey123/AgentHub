CREATE TABLE auth_tokens (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  description TEXT,
  scopes TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  csrf_token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_auth_tokens_fingerprint ON auth_tokens (fingerprint);
CREATE INDEX idx_auth_tokens_revoked ON auth_tokens (revoked_at, expires_at);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);
