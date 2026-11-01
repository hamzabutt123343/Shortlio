"use client";

import { useCallback, useRef, useState } from "react";
import { Download, Loader2, MonitorSmartphone } from "lucide-react";
import { Button } from "@/components/ui";
import { DESKTOP_DOWNLOAD_API_PATH, formatBytes } from "@/lib/desktop";

type Meta = {
  version: string;
  fileName: string;
  sizeBytes: number;
  downloadPath: string;
};

type Phase = "idle" | "resolving" | "starting" | "done" | "error";

type Props = {
  label?: string;
  className?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  showProgress?: boolean;
};

/**
 * Starts the Windows .exe download without navigating away from Shortlio.
 * Uses a hidden iframe aimed at the same-origin API (which 302s to the asset).
 */
export function WindowsDownloadButton({
  label = "Download for Windows",
  className,
  variant = "primary",
  showProgress = true,
}: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const startDownload = useCallback(async () => {
    setError(null);
    setPhase("resolving");
    setProgress(15);

    try {
      const res = await fetch(`${DESKTOP_DOWNLOAD_API_PATH}?meta=1`, {
        headers: { Accept: "application/json" },
      });
      const data = (await res.json().catch(() => ({}))) as Meta & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Could not resolve installer (${res.status})`);
      }
      setMeta(data);
      setProgress(55);
      setPhase("starting");

      const path = data.downloadPath || DESKTOP_DOWNLOAD_API_PATH;
      // Cache-bust so repeated clicks always hit the API; iframe keeps this page put.
      const url = `${path}${path.includes("?") ? "&" : "?"}_=${Date.now()}`;

      let iframe = iframeRef.current;
      if (!iframe) {
        iframe = document.createElement("iframe");
        iframe.title = "Shortlio installer download";
        iframe.setAttribute("aria-hidden", "true");
        iframe.style.display = "none";
        document.body.appendChild(iframe);
        iframeRef.current = iframe;
      }
      iframe.src = url;

      setProgress(100);
      setPhase("done");
    } catch (err) {
      setPhase("error");
      setProgress(0);
      setError(err instanceof Error ? err.message : "Download failed");
    }
  }, []);

  const busy = phase === "resolving" || phase === "starting";
  const sizeLabel = meta?.sizeBytes ? formatBytes(meta.sizeBytes) : "";

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant={variant}
        className={className}
        disabled={busy}
        onClick={() => void startDownload()}
      >
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
        ) : phase === "done" ? (
          <Download className="mr-2 h-4 w-4" aria-hidden />
        ) : (
          <MonitorSmartphone className="mr-2 h-4 w-4" aria-hidden />
        )}
        {busy
          ? phase === "resolving"
            ? "Preparing installer…"
            : "Starting download…"
          : label}
      </Button>

      {showProgress && busy && (
        <div className="w-full max-w-xs" role="status" aria-live="polite">
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">
            {phase === "resolving"
              ? "Finding the latest Windows installer…"
              : meta
                ? `Starting ${meta.fileName}${sizeLabel ? ` (${sizeLabel})` : ""}…`
                : "Starting download…"}
          </p>
        </div>
      )}

      {showProgress && phase === "done" && meta && (
        <p className="max-w-sm text-xs leading-relaxed text-[var(--text-muted)]" role="status">
          Download started: <span className="text-[var(--text)]">{meta.fileName}</span>
          {sizeLabel ? ` · ${sizeLabel}` : ""} · v{meta.version}. Check your browser download bar.
        </p>
      )}

      {phase === "error" && (
        <p className="max-w-sm text-xs leading-relaxed text-[var(--danger)]" role="alert">
          {error}{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => void startDownload()}
          >
            Try again
          </button>
        </p>
      )}
    </div>
  );
}
