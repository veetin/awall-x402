import { PGlite } from "@electric-sql/pglite";
import { MIGRATIONS_FOLDER, schema, type Database } from "@awall/ledger";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

/** A test database plus the handle that can take it away again. */
export type TestDbHandle = {
  db: Database;
  /** Close the in-process server, so later queries fail like a real outage. */
  close: () => Promise<void>;
};

/** In-process Postgres, same migrations the package ships. */
export async function createTestDbHandle(): Promise<TestDbHandle> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, close: () => client.close() };
}

/** In-process Postgres, same migrations the package ships. */
export async function createTestDb(): Promise<Database> {
  const handle = await createTestDbHandle();
  return handle.db;
}
