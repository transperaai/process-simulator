import Link from "next/link";
import { northbeamBundle } from "@transpera-flow/db";
import { AppHeader } from "@/components/app-header";
import { DemoRoster } from "@/components/roster-views";
import type { RosterData } from "@/lib/clients/roster";

/** Northbeam's client roster from the seed fixtures, no database needed. */
export default function DemoClientsPage() {
  const b = northbeamBundle();
  const data: RosterData = {
    workspace: b.workspace,
    canEdit: true,
    roles: b.roles,
    people: b.people,
    personRoles: b.personRoles,
    services: b.services,
    clients: [...(b.clients ?? [])].sort((x, y) => x.name.localeCompare(y.name)),
    clientServices: b.clientServices ?? [],
    clientAssignments: b.clientAssignments ?? [],
    // Simulated health and churn risk come from the seeded pipeline and servicing processes (issue #19).
    servicingLinks: b.servicingLinks ?? [],
    simulation: b,
  };
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-12">
      <AppHeader workspace={`${b.workspace.name} · demo`} signedIn={false} />
      <nav className="mt-4 text-fg-2">
        <Link href="/demo" className="hover:underline">
          ← Back to the process
        </Link>
      </nav>
      <h1 className="mt-2 mb-1 text-xl font-bold">Clients</h1>
      <p className="mb-3 rounded-token border border-line bg-panel-2 px-3 py-2 text-fg-2">
        Demo mode: Northbeam&apos;s sample roster. Add, edit, reassign or paste clients; changes stay in this tab and are
        gone when you reload. Simulated health and churn follow your edits here; the process page simulates the seeded
        roster.
      </p>
      <DemoRoster initial={data} />
    </main>
  );
}
