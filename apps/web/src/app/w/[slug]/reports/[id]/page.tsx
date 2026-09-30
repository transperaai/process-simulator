import { notFound } from "next/navigation";
import { ShellHeader } from "@/components/shell/shell-header";
import { SummaryEditor } from "@/components/narration";
import { narrationConfigured } from "@/lib/narration/anthropic";
import { loadReportContent } from "@/lib/report/narration";
import { isUuid } from "@/lib/report/options";
import { createClient } from "@/lib/supabase/server";

/** One stored report (issues #28, #29): its executive summary, narrated with Claude on demand and editable before export. */
export default async function ReportPage(props: PageProps<"/w/[slug]/reports/[id]">) {
  const { slug, id } = await props.params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const report = await loadReportContent(supabase, id);
  if (!report) notFound();
  const { content } = report;
  const base = `/w/${encodeURIComponent(slug)}`;
  return (
    <div>
      <ShellHeader title="Report" />
      <div className="mx-auto w-full max-w-4xl px-4 pb-12 pt-6">
        <h1 className="mt-2 mb-1 text-xl font-bold">{content.title}</h1>
        <p className="mb-4 text-fg-2">
          {content.run.reps} replications of {content.run.horizonWeeks} weeks from {content.run.startDate}
          {report.hasPdf && (
            <>
              {" · "}
              <a href={`/api/reports/${id}/pdf`} className="underline" target="_blank" rel="noreferrer">
                Download PDF
              </a>
            </>
          )}
        </p>
        {content.summary ? (
          <SummaryEditor
            reportId={id}
            initial={content.summary}
            configured={narrationConfigured()}
            canNarrate={Boolean(content.run.id)}
            printUrl={`${base}/reports/${id}/print`}
          />
        ) : (
          <p className="text-fg-2">This report was generated without an executive summary.</p>
        )}
      </div>
    </div>
  );
}
