import { headers } from "next/headers";
import { authenticateHostedRequest } from "@/lib/api/trainer2/authentication";

export const dynamic = "force-dynamic";

export default async function AuthPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  let signedIn = false;
  try {
    await authenticateHostedRequest(new Request("https://request.invalid", { headers: await headers() }));
    signedIn = true;
  } catch { /* render signed-out state without provider details */ }
  const { notice } = await searchParams;
  return <main className="mx-auto max-w-lg space-y-5 p-8">
    <h1 className="text-2xl font-semibold">Trainer2 sign in</h1>
    <p>{signedIn ? "Signed in." : "Signed out."}</p>
    <p>Trainer2 application access is disabled. Signing in does not create a training account or grant Draft access.</p>
    {notice === "sent" && <p role="status">If this address is eligible, a sign-in link will arrive. Open it in this browser.</p>}
    {notice === "logout-incomplete" && <p role="status">This browser is signed out. The identity service could not confirm session revocation.</p>}
    <form action="/trainer2/auth/sign-in" method="post" className="space-y-3">
      <label className="block">Email <input className="block border p-2" name="email" type="email" required maxLength={254} autoComplete="email" /></label>
      <button className="rounded border px-3 py-2" type="submit">Send sign-in link</button>
    </form>
    <form action="/trainer2/auth/logout" method="post">
      <button className="rounded border px-3 py-2" type="submit">Sign out</button>
    </form>
  </main>;
}
