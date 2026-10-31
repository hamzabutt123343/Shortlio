import { jsonOk } from "@/lib/api";
import { getWorkerStatus } from "@/lib/worker-status";

export async function GET() {
  const worker = await getWorkerStatus();
  return jsonOk({
    ok: true,
    service: "shortlio-web",
    processingMode: "desktop-local",
    /** Optional cloud/dev poller heartbeat — not required for Windows app users. */
    worker,
    timestamp: new Date().toISOString(),
  });
}
