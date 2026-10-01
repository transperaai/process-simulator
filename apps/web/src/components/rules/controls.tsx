import type { AnalysisOverride, EngineModel, OverrideKind, Rating } from "@transpera-flow/engine";
import { RATING_LABELS, RATINGS } from "@transpera-flow/engine";
import { cn } from "@/lib/utils";

// Small pieces of Settings -> Analysis rules shared by the table and the Edit dialog (issue #109).

/** The colour of each rating's dot, as the issues register uses them. */
export const RATING_DOT: Record<Rating, string> = { great: "bg-good", good: "bg-warn", bad: "bg-serious", risk: "bg-crit" };

export interface SubjectOption {
  id: string;
  name: string;
}
export type Subjects = Record<OverrideKind, SubjectOption[]>;

const byName = (a: SubjectOption, b: SubjectOption) => a.name.localeCompare(b.name);

/** What an override can be attached to: the model's roles, people, steps and services, and the workspace's processes. */
export function subjectsOf(model: EngineModel | null, processes: readonly SubjectOption[]): Subjects {
  const named = (rec: Record<string, { name: string }> | undefined): SubjectOption[] =>
    Object.entries(rec ?? {})
      .map(([id, v]) => ({ id, name: v.name || id }))
      .sort(byName);
  return {
    role: named(model?.roles),
    person: named(model?.people),
    step: (model?.steps ?? []).map((s) => ({ id: s.id, name: s.name })).sort(byName),
    service: named(model?.services),
    process: [...processes].sort(byName),
  };
}

/** An override's subject by name: the live name when it still exists, the name it was added with, or a plain fallback. */
export function subjectLabel(subjects: Subjects, o: Pick<AnalysisOverride, "kind" | "id" | "label">): string {
  return subjects[o.kind].find((s) => s.id === o.id)?.name ?? (o.label ? `${o.label} (no longer there)` : "Something that's gone");
}

/** The four bands as coloured chips; a band the rule doesn't have is a dash. */
export function BandChips({ bands, dimmed }: { bands: readonly string[]; dimmed?: boolean }) {
  return (
    <div className={cn("grid gap-2 sm:grid-cols-2 lg:grid-cols-4", dimmed && "opacity-50")}>
      {RATINGS.map((r, i) => (
        <div key={r} className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border px-2.5 py-1.5">
          <span className="flex items-center gap-1.5 text-xs font-medium">
            <span className={cn("size-2 rounded-full", RATING_DOT[r])} aria-hidden />
            {RATING_LABELS[r]}
          </span>
          <span className="text-sm">{bands[i] || <span className="text-muted-foreground">none</span>}</span>
        </div>
      ))}
    </div>
  );
}
