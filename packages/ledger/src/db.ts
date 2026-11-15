import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import { schema } from "./schema.js";

export type Schema = typeof schema;
type Relations = ExtractTablesWithRelations<Schema>;

/**
 * A Drizzle Postgres connection over this schema, whatever the driver.
 *
 * The package never opens a connection of its own: every function takes the
 * connection, so the gateway owns the pool and the tests can hand over an
 * in-process PGlite instance.
 */
export type Database = PgDatabase<PgQueryResultHKT, Schema, Relations>;

/** An open transaction over the same schema. */
export type Transaction = PgTransaction<PgQueryResultHKT, Schema, Relations>;

/** Either a connection or an open transaction. */
export type Executor = Database | Transaction;

/** Re-exported so callers can build a typed driver instance. */
export { schema };
