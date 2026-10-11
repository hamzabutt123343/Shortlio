import { jsonOk } from "@/lib/api";
import { getWorkerStatus } from "@/lib/worker-status";

export async function GET() {
  const worker = await getWorkerStatus();
  return jsonOk({
    ok: true,
    service: "shortlio-web",
    worker,
    timestamp: new Date().toISOString(),
  });
}
