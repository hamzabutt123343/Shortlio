import { NextResponse } from "next/server";
import { handleRouteError, jsonError, jsonOk, rateLimit } from "@/lib/api";
import { resolveLatestWindowsInstaller } from "@/lib/desktop-release";

export const runtime = "nodejs";
/** Bump to force Next to reload this route handler during local testing. */
export const dynamic = "force-dynamic";

function isMissingReleaseError(message: string): boolean {
  return (
    /No published desktop/i.test(message) ||
    /not publicly reachable/i.test(message) ||
    /DESKTOP_INSTALLER_URL/i.test(message)
  );
}

/**
 * GET /api/desktop/download
 *   → 302 to the latest Windows .exe on GitHub Releases (starts download; no Releases page).
 * GET /api/desktop/download?meta=1
 *   → JSON { version, fileName, sizeBytes, downloadPath, … } for UI progress labels.
 *
 * Always resolves the newest desktop-v* release so the link stays current after each tag.
 */
export async function GET(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "anon";
  const limited = rateLimit(`desktop-download:${ip}`, 30, 60_000);
  if (!limited.ok) {
    return jsonError("Too many download requests", 429, {
      retryAfter: limited.retryAfter,
    });
  }

  const { searchParams } = new URL(request.url);
  const wantMeta =
    searchParams.get("meta") === "1" ||
    searchParams.get("meta") === "true" ||
    (request.headers.get("accept") || "").includes("application/json");

  let installer;
  try {
    installer = await resolveLatestWindowsInstaller();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isMissingReleaseError(message)) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return handleRouteError(err);
  }

  try {
    if (wantMeta) {
      return jsonOk(
        {
          version: installer.version,
          tagName: installer.tagName,
          fileName: installer.fileName,
          sizeBytes: installer.sizeBytes,
          publishedAt: installer.publishedAt,
          /** Same-origin path that triggers the .exe download. */
          downloadPath: "/api/desktop/download",
          htmlUrl: installer.htmlUrl,
        },
        {
          headers: {
            "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
          },
        },
      );
    }

    // 302 to the raw asset URL. Callers must use a hidden iframe / download trigger so the
    // main Shortlio tab never navigates (including not to github.com/releases).
    return NextResponse.redirect(installer.downloadUrl, {
      status: 302,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${installer.fileName.replace(/"/g, "")}"`,
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}