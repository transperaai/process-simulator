import Link from "next/link";
import { Network } from "lucide-react";
import { NewProcessButton, type CreateProcess } from "@/components/new-process-dialog";
import { ProcessesTable } from "@/components/processes/processes-table";
import { Page } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import type { ProcessCardData } from "@/lib/processes/data";
import type { ProcessRowData } from "@/lib/processes/rows";

/**
 * The Processes page (issue #101): the company map as a list, sub-processes indented under their parent. A row
 * opens in place to that process's map card. Replaces the A33 placeholder list.
 */
export function ProcessesPage({
  rows,
  hrefs,
  companyMapHref,
  loadCard,
  create,
  note,
}: {
  rows: ProcessRowData[];
  hrefs: Record<string, string>;
  /** Where the company map lives. */
  companyMapHref: string;
  loadCard: (processId: string) => Promise<ProcessCardData | null>;
  /** Start a process (signed-in editors only). */
  create?: CreateProcess;
  /** A line under the table, such as the demo's reminder that nothing is kept. */
  note?: string;
}) {
  return (
    <Page
      title="Processes"
      eyebrow="Company"
      width="max-w-6xl"
      description="The company map and everything inside it. Open a row to see that process's map card."
      actions={
        <>
          <Button variant="outline" asChild>
            <Link href={companyMapHref}>
              <Network /> Company map
            </Link>
          </Button>
          {create && <NewProcessButton create={create} />}
        </>
      }
    >
      <ProcessesTable rows={rows} hrefs={hrefs} loadCard={loadCard} />
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </Page>
  );
}
