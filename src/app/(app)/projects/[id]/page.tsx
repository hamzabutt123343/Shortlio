import { notFound, redirect } from "next/navigation";
import { ProjectLive } from "@/components/project-live";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ id: string }> };

export default async function ProjectPage({ params }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [{ id }, supabase] = await Promise.all([params, createClient()]);

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!project) notFound();

  const [{ data: jobs }, { data: candidates }, { data: clips }] = await Promise.all([
    supabase.from("jobs").select("*").eq("project_id", id).order("created_at", { ascending: false }),
    supabase
      .from("clip_candidates")
      .select("*")
      .eq("project_id", id)
      .order("score", { ascending: false }),
    supabase.from("clips").select("*").eq("project_id", id).order("created_at", { ascending: true }),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <ProjectLive
        projectId={id}
        initial={{
          project,
          jobs: jobs ?? [],
          candidates: candidates ?? [],
          clips: clips ?? [],
        }}
      />
    </div>
  );
}
