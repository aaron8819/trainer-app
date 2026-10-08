import { NextResponse, type NextRequest } from "next/server";
import { privateAuthResponse } from "@/lib/api/trainer2/auth-response";
import { currentDeploymentDecision } from "@/lib/operations/deployment-boundary";
import {
  UI_AUDIT_FIXTURE_HEADER,
  authorizeUiAuditFixtureRequest,
} from "@/lib/ui-audit-fixtures/access";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const deployment = currentDeploymentDecision();
  if (deployment === "deny") return new NextResponse(null, { status: 503 });
  if ((deployment === "hosted-test" || deployment === "v2-production") && request.headers.get("host") !== new URL(process.env.TRAINER2_APP_ORIGIN!).host)
    return new NextResponse(null, { status: 404 });
  if (deployment === "v2-production" && pathname === "/") {
    const training = request.nextUrl.clone();
    training.pathname = "/trainer2";
    return privateAuthResponse(NextResponse.rewrite(training));
  }
  if ((deployment === "preview" || deployment === "hosted-test" || deployment === "v2-production") &&
    !(deployment === "v2-production" && pathname === "/manifest.webmanifest") &&
    !(pathname === "/trainer2" || pathname === "/trainer2/auth" || pathname.startsWith("/trainer2/auth/") ||
    pathname.startsWith("/api/trainer2/") || pathname.startsWith("/trainer2/dev/") ||
    pathname.startsWith("/_next/") || pathname.startsWith("/brand/") || pathname.startsWith("/icons/") ||
    pathname === "/favicon.ico" || pathname === "/apple-icon.png"))
    return new NextResponse(null, { status: 404 });
  if (
    pathname.startsWith("/ui-audit-fixture") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/brand/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/apple-icon.png" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const scenario = authorizeUiAuditFixtureRequest({
    mode: process.env.UI_AUDIT_FIXTURE_MODE,
    nodeEnv: process.env.NODE_ENV,
    requestHeader: request.headers.get(UI_AUDIT_FIXTURE_HEADER),
  });
  if (!scenario) {
    if (pathname.startsWith("/trainer2/auth/")) return privateAuthResponse(NextResponse.next());
    if (pathname === "/trainer2" || pathname === "/trainer2/auth" || pathname.startsWith("/api/trainer2/") || pathname.startsWith("/trainer2/dev/"))
      return privateAuthResponse(NextResponse.next());
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        error:
          "The database-free UI audit requires an explicit browser fixture handler for this request.",
      },
      { status: 501 },
    );
  }
  if (request.method !== "GET") {
    return NextResponse.json(
      { error: "UI audit fixture pages are read-only." },
      { status: 405 },
    );
  }

  const fixtureUrl = request.nextUrl.clone();
  fixtureUrl.pathname = "/ui-audit-fixture";
  fixtureUrl.search = "";
  fixtureUrl.searchParams.set("path", pathname);
  return NextResponse.redirect(fixtureUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
