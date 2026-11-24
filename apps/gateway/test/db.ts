import { PGlite } from "@electric-sql/pglite";
import { MIGRATIONS_FOLDER, schema, type Database } from "@awall/ledger";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

/** In-process Postgres, same migrations the package ships. */
export async function createTestDb(): Promise<Database> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}
