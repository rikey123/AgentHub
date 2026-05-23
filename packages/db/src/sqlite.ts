import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as schema from "./schema.ts";

export type AgentHubDatabase = {
  sqlite: Database.Database;
  drizzle: BetterSQLite3Database<typeof schema>;
};

export type CreateDatabaseOptions = {
  readonly path: string;
  readonly applyPragmas?: boolean;
  readonly applyMigrations?: boolean;
  readonly migrationsDir?: string;
};

export type MigrationRecord = {
  readonly id: string;
  readonly appliedAt: number;
};

const sourceDir = dirname(fileURLToPath(import.meta.url));
export const defaultMigrationsDir = resolve(sourceDir, "..", "migrations");

export function createDatabase(options: CreateDatabaseOptions): AgentHubDatabase {
  const sqlite = new Database(options.path);
  if (options.applyPragmas !== false) {
    applySqlitePragmas(sqlite);
  }
  if (options.applyMigrations === true) {
    applyMigrations(sqlite, options.migrationsDir ?? defaultMigrationsDir);
  }

  return {
    sqlite,
    drizzle: drizzle(sqlite, { schema })
  };
}

export function applySqlitePragmas(sqlite: Database.Database): void {
  sqlite.pragma("page_size = 4096");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("temp_store = MEMORY");
  sqlite.pragma("mmap_size = 268435456");
}

export function applyMigrations(sqlite: Database.Database, migrationsDir = defaultMigrationsDir): MigrationRecord[] {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __agenthub_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    sqlite.prepare("SELECT id FROM __agenthub_migrations").all().map((row) => (row as { id: string }).id)
  );
  const migrationFiles = readdirSync(migrationsDir)
    .filter((fileName) => /^\d{4}_.+\.sql$/.test(fileName))
    .sort();
  const insertMigration = sqlite.prepare(
    "INSERT INTO __agenthub_migrations (id, applied_at) VALUES (?, ?)"
  );
  const appliedNow: MigrationRecord[] = [];

  for (const fileName of migrationFiles) {
    if (applied.has(fileName)) {
      continue;
    }
    const sql = readFileSync(join(migrationsDir, fileName), "utf8");
    const appliedAt = Date.now();
    sqlite.transaction(() => {
      sqlite.exec(sql);
      insertMigration.run(fileName, appliedAt);
    })();
    appliedNow.push({ id: fileName, appliedAt });
  }

  return appliedNow;
}
