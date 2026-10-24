import { execSync } from "node:child_process";
import pg from "pg";
import { testEnv } from "./test-env.js";

export default async function setup() {
  const adminUrl = new URL(testEnv.DATABASE_URL);
  adminUrl.pathname = "/postgres";

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'uniblox_test'");
  if (!rowCount) await admin.query("CREATE DATABASE uniblox_test");
  await admin.end();

  execSync("npx prisma migrate deploy", { env: { ...process.env, ...testEnv }, stdio: "ignore" });
}
