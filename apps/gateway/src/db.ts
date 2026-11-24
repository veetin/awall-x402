import { PGlite } from "@electric-sql/pglite";
import {
  MIGRATIONS_FOLDER,
  createLedgerDatabase,
  runMigrations,
  schema,
  type Database,
} from "@awall/ledger";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

/**
 * Open the ledger.
 *
 * `DATABASE_URL` selects Postgres. Without it the gateway runs on PGlite, so
 * `pnpm dev` and the demo script need no database server. Restarting that
 * process drops the embedded database; set `DATABASE_URL` to keep it.
 *
 * @param url - Postgres connection string, or empty for PGlite.
 * @returns A migrated ledger connection.
 */
export async function openDatabase(url: string): Promise<Database> {
  if (url) {
    const db = createLedgerDatabase(url);
    await runMigrations(db);
    return db;
  }
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}
