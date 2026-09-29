import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";

// Creates a throwaway database, loads the auth shim, every migration and the
// seed, and lets tests run queries as a given user (RLS applies).

const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const dir = (p: string) => new URL(p, import.meta.url);

export interface TestDb {
  client: pg.Client;
  /** Run `fn` as `authenticated` with the given JWT claims, inside a rolled-back transaction. */
  as<T>(claims: Record<string, unknown> | null, fn: (c: pg.Client) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const name = `flowsim_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();

  await client.query(readFileSync(dir("./sql/auth-shim.sql"), "utf8"));
  const migrations = readdirSync(dir("../supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const file of migrations) {
    await client.query(readFileSync(dir(`../supabase/migrations/${file}`), "utf8"));
  }
  await client.query(readFileSync(dir("../supabase/seed.sql"), "utf8"));

  return {
    client,
    async as(claims, fn) {
      await client.query("begin");
      try {
        await client.query("set local role authenticated");
        await client.query("select set_config('request.jwt.claims', $1, true)", [claims ? JSON.stringify(claims) : ""]);
        return await fn(client);
      } finally {
        await client.query("rollback");
      }
    },
    async close() {
      await client.end();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

export async function createUser(db: TestDb, email: string, appMetadata: Record<string, unknown> = {}) {
  const id = randomUUID();
  await db.client.query("insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, $3)", [id, email, appMetadata]);
  return { id, claims: { sub: id, role: "authenticated", app_metadata: appMetadata } };
}
