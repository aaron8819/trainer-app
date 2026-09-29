import { headers } from "next/headers";
import { databaseFor } from "@/lib/api/trainer2/database";
import { developmentEnabled } from "@/lib/api/trainer2/development";
import { sessionForRequest, soleOwner } from "@/lib/api/trainer2/sessions";
import { hostedTestEnabled } from "@/lib/api/trainer2/access";

export const dynamic = "force-dynamic";

export default async function AuthPage() {
  let signedIn = false;
  let setup = false;
  const enabled = developmentEnabled() || hostedTestEnabled();
  if (enabled) try {
    const db = await databaseFor("identity", developmentEnabled());
    setup = !(await soleOwner(db)).passcodeVerifier;
    await sessionForRequest(db, new Request("https://request.invalid", { headers: await headers() }));
    signedIn = true;
  } catch { /* render signed-out state without persistence details */ }
  return <main className="mx-auto max-w-lg space-y-5 p-8">
    <h1 className="text-2xl font-semibold">Trainer2 sign in</h1>
    <p>{signedIn ? "Signed in." : "Signed out."}</p>
    {enabled && !signedIn && <form action={setup ? "/trainer2/auth/setup" : "/trainer2/auth/sign-in"} method="post" className="space-y-3">
      {setup && <label className="block">One-time setup code <input className="block border p-2" name="setupCode" type="password" required autoComplete="off" /></label>}
      <label className="block">Passcode <input className="block border p-2" name="passcode" type="password" required minLength={12} maxLength={128} autoComplete={setup ? "new-password" : "current-password"} /></label>
      <button className="rounded border px-3 py-2" type="submit">{setup ? "Set passcode" : "Sign in"}</button>
    </form>}
    {signedIn && <><form action="/trainer2/auth/logout" method="post"><button className="rounded border px-3 py-2" type="submit">Sign out this device</button></form>
      <form action="/trainer2/auth/revoke-all" method="post"><button className="rounded border px-3 py-2" type="submit">Sign out every device</button></form></>}
  </main>;
}
