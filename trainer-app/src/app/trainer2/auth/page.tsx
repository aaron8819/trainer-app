import { headers } from "next/headers";
import { databaseFor } from "@/lib/api/trainer2/database";
import { developmentEnabled } from "@/lib/api/trainer2/development";
import { sessionForRequest, soleOwner } from "@/lib/api/trainer2/sessions";
import { hostedEnabled } from "@/lib/api/trainer2/access";
import Link from 'next/link';

export const dynamic = "force-dynamic";

export default async function AuthPage() {
  let signedIn = false;
  let setup = false;
  let recovery: { accountId: string; epoch: number } | null = null;
  const enabled = developmentEnabled() || hostedEnabled();
  if (enabled) try {
    const db = await databaseFor("identity", developmentEnabled());
    const owner = await soleOwner(db);
    setup = !owner.passcodeVerifier;
    await sessionForRequest(db, new Request("https://request.invalid", { headers: await headers() }));
    signedIn = true;
    recovery = { accountId: owner.accountId, epoch: owner.sessionEpoch };
  } catch { /* render signed-out state without persistence details */ }
  return <main className="mx-auto max-w-lg space-y-5 p-8">
    <h1 className="text-2xl font-semibold">{signedIn ? 'Device access' : 'Trainer2 sign in'}</h1>
    <p>{signedIn ? "Signed in." : "Signed out."}</p>
    {enabled && !signedIn && <form action={setup ? "/trainer2/auth/setup" : "/trainer2/auth/sign-in"} method="post" className="space-y-3">
      {setup && <label className="block">One-time setup code <input className="block border p-2" name="setupCode" type="password" required autoComplete="off" /></label>}
      <label className="block">Passcode <input className="block border p-2" name="passcode" type="password" required minLength={12} maxLength={128} autoComplete={setup ? "new-password" : "current-password"} /></label>
      <button className="rounded border px-3 py-2" type="submit">{setup ? "Set passcode" : "Sign in"}</button>
    </form>}
    {signedIn && <><form action="/trainer2/auth/logout" method="post"><button className="rounded border px-3 py-2" type="submit">Sign out this device</button></form>
      <form action="/trainer2/auth/revoke-all" method="post"><button className="rounded border px-3 py-2" type="submit">Sign out every device</button></form></>}
    {signedIn && recovery && <details className="space-y-3">
      <summary className="min-h-11 cursor-pointer py-2">Choose a new passcode</summary>
      <p>This replaces your passcode and signs out every V2 device, including this one.
        Your plan and history stay unchanged. You will sign in again with the new passcode.</p>
      <form action="/trainer2/auth/replace-passcode" method="post" className="space-y-3">
        <input type="hidden" name="accountId" value={recovery.accountId} />
        <input type="hidden" name="epoch" value={recovery.epoch} />
        <label className="block">New passcode <input className="block border p-2"
          name="passcode" type="password" required minLength={12} maxLength={128}
          autoComplete="new-password" /></label>
        <label className="block">Confirm new passcode <input className="block border p-2"
          name="confirmation" type="password" required minLength={12} maxLength={128}
          autoComplete="new-password" /></label>
        <button className="min-h-11 rounded border px-3 py-2" type="submit">
          Replace passcode and sign out every V2 device
        </button>
      </form>
    </details>}
    <Link className="inline-flex min-h-11 items-center underline" href="/trainer2">Back to Training</Link>
  </main>;
}
