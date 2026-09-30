import Link from "next/link";
import { engineRecurrence, type ProcessBundle } from "@transpera-flow/db";
import { recurrenceLabel } from "@transpera-flow/engine";
import { formatNumber } from "@/lib/format";

/**
 * What a servicing process is for (issue #19): which services' clients run it,
 * how often, and its SLA. Its tasks go to each client's assigned person for a
 * step's role (their stand-in while on leave), beside the pipeline.
 */
export function ServicingBanner({ bundle, settingsHref }: { bundle: ProcessBundle; settingsHref?: string }) {
  const links = (bundle.servicingLinks ?? []).filter((l) => l.process_id === bundle.process.id);
  const serviceName = new Map(bundle.services.map((s) => [s.id, s.name]));
  const hoursPerDay = bundle.workspace.settings.hours_per_week / 5;
  const sla = (h: number) => (h % hoursPerDay === 0 ? `${formatNumber(h / hoursPerDay, 0)} working day${h === hoursPerDay ? "" : "s"}` : `${formatNumber(h)} h`);
  return (
    <section aria-label="Servicing process" className="rounded-token border border-line bg-panel-2 px-3 py-2 text-sm text-fg-2">
      <span className="font-semibold text-fg">Servicing process.</span>{" "}
      {links.length ? (
        <>
          Every client on{" "}
          {links.map((l, i) => {
            const r = engineRecurrence(l.recurrence);
            return (
              <span key={l.id}>
                {i > 0 ? (i === links.length - 1 ? " and " : ", ") : ""}
                <span className="text-fg">{serviceName.get(l.service_id) ?? "a service"}</span> ({r ? recurrenceLabel(r) : "?"}, on time within {sla(Number(l.sla_hours))})
              </span>
            );
          })}{" "}
          runs it. Each task goes to the client&apos;s assigned person for a step&apos;s role (the role&apos;s other people while they are
          on leave), competes with the pipeline for their time, and moves the client&apos;s health: on time it recovers, late or
          missed it drops.
        </>
      ) : (
        <>No service runs it yet, so it generates no tasks.</>
      )}{" "}
      {settingsHref && (
        <Link href={settingsHref} className="underline">
          Link it to services in Settings
        </Link>
      )}
    </section>
  );
}
