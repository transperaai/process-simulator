import { ShellHeader } from "@/components/shell/shell-header";
import { DemoReportBuilder } from "@/components/report-builder";
import { DEMO_DEFAULT_SCENARIOS, demoScenarios } from "@/lib/report/demo";

/** The report builder on the demo (issue #28): the Northbeam sample, generated on the server, no database. */
export default function DemoReportPage() {
  const scenarios = demoScenarios().map((s) => ({ id: s.id, name: s.name, description: s.description, needsAttention: null }));
  return (
    <div>
      <ShellHeader title="Report" />
      <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-6">
        <h1 className="mt-2 mb-1 text-xl font-bold">Report</h1>
        <p className="mb-4 rounded-token border border-line bg-panel-2 px-3 py-2 text-fg-2">
          Demo mode: the report of the Northbeam sample as the seed fixtures define it (edits made on /demo stay in your tab and aren&apos;t
          included). The PDF is printed by headless Chromium on the server; “Open printable report” shows the same document for your
          browser&apos;s Save as PDF.
        </p>
        <DemoReportBuilder scenarios={scenarios} defaultScenarios={DEMO_DEFAULT_SCENARIOS} />
      </div>
    </div>
  );
}
