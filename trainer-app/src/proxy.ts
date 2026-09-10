import { NextResponse, type NextRequest } from "next/server";
import { privateAuthResponse, refreshAuthRequest } from "@/lib/api/trainer2/auth-http";
import {
  UI_AUDIT_FIXTURE_HEADER,
  authorizeUiAuditFixtureRequest,
} from "@/lib/ui-audit-fixtures/access";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
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
    if (pathname === "/trainer2/auth" || pathname.startsWith("/api/trainer2/") || pathname.startsWith("/trainer2/dev/")) {
      return refreshAuthRequest(request);
    }
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
