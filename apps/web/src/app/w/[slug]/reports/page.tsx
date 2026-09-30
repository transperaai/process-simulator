import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { ReportBuilder, StoredReports } from "@/components/report-builder";
import { narrationConfigured } from "@/lib/narration/anthropic";
import { loadReportsPage } from "@/lib/report/page-data";

/** Reports (issue #28; docs/PRD.md §8 screen 12, §9): choose sections and scenarios, generate the PDF, and earlier reports. */
export default async function ReportsPage(props: PageProps<"/w/[slug]/reports">) {
  const { slug } = await props.params;
  const { process } = await props.searchParams;
  const data = await loadReportsPage(slug, typeof process === "string" ? process : null);
  if (!data) notFound();
  const base = `/w/${slug}`;
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12">
      <AppHeader workspace={data.workspace.name} signedIn />
      <nav className="mt-4 text-fg-2">
        <Link href={data.processId ? `${base}/p/${data.processId}` : base} className="hover:underline">
          ← Back to the process
        </Link>
      </nav>
      <h1 className="mt-2 mb-1 text-xl font-bold">Reports</h1>
      {!data.canEdit ? (
        <p className="text-fg-2">Reports include per-person utilisation, so editors, owners and agency admins generate and read them.</p>
      ) : !data.processId ? (
        <p className="text-fg-2">Publish a pipeline process first: reports are of the live model.</p>
      ) : (
        <>
          <p className="mb-4 text-fg-2">
            A handover-quality PDF of the live model: every number comes from one saved run, with its range. Choose what goes in, then generate.
          </p>
          {data.processes.length > 1 && (
            <nav className="mb-3 flex flex-wrap gap-2 text-sm" aria-label="Process">
              {data.processes.map((p) => (
                <Link
                  key={p.id}
                  href={`${base}/reports?process=${p.id}`}
                  aria-current={p.id === data.processId ? "page" : undefined}
                  className={`rounded-token border px-2 py-1 ${p.id === data.processId ? "border-accent bg-accent-soft font-semibold" : "border-line hover:bg-panel-2"}`}
                >
                  {p.name}
                </Link>
              ))}
            </nav>
          )}
          {data.modelError ? (
            <p className="text-crit">This process can&apos;t be simulated yet: {data.modelError}</p>
          ) : (
            <ReportBuilder
              key={data.processId}
              slug={slug}
              processId={data.processId}
              scenarios={data.scenarios}
              runs={data.runs}
              narrationConfigured={narrationConfigured()}
            />
          )}
          <h2 className="mt-8 mb-2 text-lg font-bold">Earlier reports</h2>
          <StoredReports slug={slug} reports={data.reports} />
        </>
      )}
    </main>
  );
}
