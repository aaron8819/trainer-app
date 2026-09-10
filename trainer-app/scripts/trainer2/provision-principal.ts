import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";

const binding = z.object({ issuer: z.string().min(1).max(2048), subject: z.string().min(1).max(2048), accountId: z.string().min(1).max(256) }).strict();

/** Administrative library only; never imported by app routes. Caller must classify and
 * authorize its environment before opening this dedicated administrative pool.
 * Insert-or-confirm only: no user creation, email lookup, update, or ownership transfer. */
export async function provisionPrincipal(pool: Pool, input: unknown) {
  const value = binding.parse(input);
  if (Object.values(value).some(s => s.trim() !== s)) throw new Error("PRINCIPAL_BINDING_INVALID");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const role = (await client.query("SELECT current_user AS name, session_user AS session")).rows[0];
    if (role.name !== "trainer2_principal_admin" || role.session !== role.name) throw new Error("PRINCIPAL_ADMIN_ROLE_REQUIRED");
    const inserted = await client.query(`INSERT INTO public."Trainer2AccountPrincipal" (id,issuer,subject,"accountId") VALUES ($1,$2,$3,$4)
      ON CONFLICT (issuer,subject) DO NOTHING RETURNING id,issuer,subject,"accountId"`, [randomUUID(), value.issuer, value.subject, value.accountId]);
    const row = inserted.rows[0] ?? (await client.query(`SELECT id,issuer,subject,"accountId" FROM public."Trainer2AccountPrincipal" WHERE issuer=$1 AND subject=$2`, [value.issuer, value.subject])).rows[0];
    if (!row || row.accountId !== value.accountId) throw new Error("PRINCIPAL_BINDING_CONFLICT");
    await client.query("COMMIT");
    return { ...row, created: Boolean(inserted.rowCount) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
