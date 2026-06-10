-- Soft-delete support for rooms: deleted rooms are hidden from all lists but
-- retained in the database for potential restore/audit. NULL = not deleted.
ALTER TABLE rooms ADD COLUMN deleted_at INTEGER;
