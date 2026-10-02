"use client";

// "+ Link" on the screens a source can be evidence for (issue #118, A53 slice 2): the step detail, the Editor's inspector, the
// insight pop-up, and the issue, solution and process pages. A page wraps what it shows in <SourceLinkingProvider> with the
// workspace's sources, links and link targets; anywhere inside, <LinkedSources target=...> lists the sources linked to one
// thing with a "+ Link" and a remove button on each, and the provider holds the one Add / Link source dialog they all open.
// Outside a provider (a screen that doesn't load the links) the component draws nothing, so the old lists stay as they were.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  linkTarget,
  sameTarget,
  type LinkTargets,
  type SourceLinkRow,
  type SourceLinkTarget,
  type SourceRow,
} from "@transpera-flow/db";
import { Help } from "@/components/help";
import { SourceDialog, type SourceSubmission } from "@/components/sources/source-dialog";
import { Button } from "@/components/ui/button";
import { useDemoSolutions } from "@/lib/solutions/demo";
import { demoSourceStore } from "@/lib/sources/demo-store";
import { targetValue } from "@/lib/sources/links";
import { liveSourceStore } from "@/lib/sources/live-store";
import { MemorySourceStore, type SourceStore } from "@/lib/sources/store";
import { SOURCE_KIND_LABELS } from "@/lib/sources/validate";

/** The (i) texts: what the Sources block and its "+ Link" mean. */
export const LINKED_SOURCES_HELP = {
  sources: {
    label: "Sources",
    description: "The interviews, notes and data that show this is real. A source linked here counts as evidence for it, and one source can be linked to many things.",
    example: "Interview: Maya Collins, “I review every single report before it goes out.”",
  },
  link: {
    label: "Link a source",
    description: "Link a source to this: add a new one, or pick one you have already added. Linking doesn't change what else the source is linked to.",
    example: "Link the notes from the ops walkthrough to the step Access requests.",
  },
} as const;

// TODO(A50): the solution page isn't built yet (PR #156). When it lands, give it
// <LinkedSources target={{ kind: "solution", solutionId }} label={`Solution: ${name}`} /> inside a <SourceLinkingScope> (live) like
// the issue page, and its "+ Link" works without anything else here: the dialog and the link table already take solutions.

export interface SourceLinking {
  canEdit: boolean;
  sources: readonly SourceRow[];
  links: readonly SourceLinkRow[];
  /** The sources linked to a thing, with the link that says so. */
  linkedTo: (target: SourceLinkTarget) => { source: SourceRow; link: SourceLinkRow }[];
  /** Open the Add / Link source dialog for a thing. `label` is what it is called ("Step: Check fit"). */
  open: (target: SourceLinkTarget, label: string) => void;
  unlink: (link: SourceLinkRow) => Promise<void>;
  error: string | null;
  busy: boolean;
}

const Context = createContext<SourceLinking | null>(null);

/** What a screen can do about sources, or null when it doesn't load them. */
export const useSourceLinking = () => useContext(Context);

export interface SourceLinkingProviderProps {
  workspaceId: string;
  /** live: saved through Server Actions; demo: kept in the tab; readonly: the viewer can't change links. */
  mode: "live" | "demo" | "readonly";
  sources: SourceRow[];
  links: SourceLinkRow[];
  targets: LinkTargets;
  children: ReactNode;
}

export function SourceLinkingProvider({ workspaceId, mode, sources: initialSources, links: initialLinks, targets: initialTargets, children }: SourceLinkingProviderProps) {
  const router = useRouter();
  const [store] = useState<SourceStore>(() =>
    mode === "live" ? liveSourceStore(workspaceId) : mode === "demo" ? demoSourceStore(workspaceId, initialSources, initialLinks) : new MemorySourceStore(workspaceId, initialSources, undefined, initialLinks),
  );
  // In the demo the store is shared by every page of the tab, so start from what it holds.
  const [state, setState] = useState(() => (mode === "demo" && store instanceof MemorySourceStore ? store.snapshot() : { sources: initialSources, links: initialLinks }));
  const [dialog, setDialog] = useState<{ target: SourceLinkTarget; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { sources, links } = state;

  // What the dialog may pick: this page's lists, plus the thing it was opened for (a step added a moment ago may not be in them yet).
  // The demo's solutions live in the tab, as on the Sources page.
  const demoSolutions = useDemoSolutions().solutions;
  const baseTargets = useMemo(
    () => (mode === "demo" ? { ...initialTargets, solutions: demoSolutions.map((x) => ({ id: x.id, name: x.name })) } : initialTargets),
    [mode, initialTargets, demoSolutions],
  );
  const targets = useMemo(() => withTarget(baseTargets, dialog), [baseTargets, dialog]);

  const linkedTo = useCallback(
    (target: SourceLinkTarget) =>
      links.flatMap((l) => {
        const t = linkTarget(l);
        const source = t && sameTarget(t, target) ? sources.find((s) => s.id === l.source_id) : undefined;
        return source ? [{ source, link: l }] : [];
      }),
    [links, sources],
  );

  const changed = () => {
    setError(null);
    // The sidebar's count comes from the server: ask for it again after a change.
    if (mode === "live") router.refresh();
  };

  const submit = async (s: SourceSubmission): Promise<string | null> => {
    if (s.kind === "add") {
      const r = await store.create(s.input, [s.link]);
      if (r.status === "error") return r.message;
      setState((c) => ({ sources: [r.source, ...c.sources], links: [...c.links, ...r.links] }));
    } else {
      const r = await store.link(s.source.id, s.link);
      if (r.status === "error") return r.message;
      setState((c) => ({ ...c, links: [...c.links, r.link] }));
    }
    changed();
    return null;
  };

  const unlink = useCallback(
    async (link: SourceLinkRow) => {
      setBusy(true);
      try {
        const r = await store.unlink(link.id);
        if (r.status === "error") return setError(r.message);
        setState((c) => ({ ...c, links: c.links.filter((l) => l.id !== link.id) }));
        changed();
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, mode],
  );

  const value = useMemo<SourceLinking>(
    () => ({
      canEdit: mode !== "readonly",
      sources,
      links,
      linkedTo,
      open: (target, label) => setDialog({ target, label }),
      unlink,
      error,
      busy,
    }),
    [mode, sources, links, linkedTo, unlink, error, busy],
  );

  const already = dialog ? new Set(linkedTo(dialog.target).map((x) => x.source.id)) : new Set<string>();
  return (
    <Context.Provider value={value}>
      {children}
      {mode !== "readonly" && (
        <SourceDialog
          open={dialog !== null}
          targets={targets}
          preset={dialog?.target ?? null}
          presetLabel={dialog?.label}
          existingSources={sources.filter((s) => !already.has(s.id))}
          onSubmit={submit}
          onClose={() => setDialog(null)}
        />
      )}
    </Context.Provider>
  );
}

/** The page's lists with the thing the dialog was opened for added when they don't have it. */
export function withTarget(targets: LinkTargets, open: { target: SourceLinkTarget; label: string } | null): LinkTargets {
  if (!open) return targets;
  const t = open.target;
  const name = open.label.replace(/^[A-Za-z ]+: /, "");
  switch (t.kind) {
    case "process":
      return targets.processes.some((p) => p.id === t.processId) ? targets : { ...targets, processes: [...targets.processes, { id: t.processId, name }] };
    case "step":
      return targets.steps.some((s) => s.id === t.stepId) ? targets : { ...targets, steps: [...targets.steps, { id: t.stepId, processId: t.processId, name }] };
    case "insight":
      return targets.insights.some((i) => i.key === t.insightKey) ? targets : { ...targets, insights: [...targets.insights, { key: t.insightKey, title: name }] };
    case "issue":
      return targets.issues.some((i) => i.id === t.issueId) ? targets : { ...targets, issues: [...targets.issues, { id: t.issueId, number: null, title: name }] };
    case "solution":
      return targets.solutions.some((s) => s.id === t.solutionId) ? targets : { ...targets, solutions: [...targets.solutions, { id: t.solutionId, name }] };
  }
}

const excerpt = (body: string | null, n = 160) => {
  const text = (body ?? "").trim().replace(/\s+/g, " ");
  return text.length <= n ? text : `${text.slice(0, n).replace(/\s+\S*$/, "")}…`;
};

/**
 * The sources linked to one thing, as a block: "Sources" with its (i), a "+ Link" (and its (i)), and each source's title, type
 * and quote with a button to take the link away. Draws nothing outside a <SourceLinkingProvider>.
 */
export function LinkedSources({
  target,
  label,
  empty = "None linked yet.",
  heading = "Sources",
  hideTitle = false,
  className,
}: {
  target: SourceLinkTarget;
  /** What the thing is called, for the dialog ("Step: Check fit"). */
  label: string;
  empty?: string;
  heading?: string;
  /** The page already has a title for it (a section called Sources): show only the "+ Link". */
  hideTitle?: boolean;
  className?: string;
}) {
  const linking = useSourceLinking();
  if (!linking) return null;
  const items = linking.linkedTo(target);
  return (
    <section aria-label={heading} data-linked-sources={targetValue(target)} className={className ?? "flex flex-col gap-1.5"}>
      <div className={hideTitle ? "flex items-center justify-end gap-2" : "flex items-center justify-between gap-2"}>
        {!hideTitle && (
          <h4 className="flex items-center text-[11px] font-semibold tracking-wide text-fg-3 uppercase">
            {heading}
            <Help {...LINKED_SOURCES_HELP.sources} />
          </h4>
        )}
        {linking.canEdit && (
          <span className="flex items-center">
            <Button type="button" variant="ghost" size="sm" onClick={() => linking.open(target, label)} aria-label={`Link a source to ${label}`}>
              + Link
            </Button>
            <Help {...LINKED_SOURCES_HELP.link} />
          </span>
        )}
      </div>
      {items.length ? (
        <ul className="flex flex-col gap-1.5">
          {items.map(({ source, link }) => (
            <li key={link.id} className="flex items-start justify-between gap-2 text-xs">
              <span className="min-w-0">
                <b className="font-semibold">{source.title}</b> <span className="text-fg-3">· {SOURCE_KIND_LABELS[source.kind]}</span>
                {source.body && <span className="block text-fg-2">“{excerpt(source.body)}”</span>}
              </span>
              {linking.canEdit && (
                <button
                  type="button"
                  disabled={linking.busy}
                  aria-label={`Remove link: ${source.title}`}
                  className="-mr-1 grid size-5 shrink-0 place-items-center rounded-full text-fg-3 outline-none hover:bg-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  onClick={() => void linking.unlink(link)}
                >
                  <span aria-hidden>×</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-fg-3">{empty}</p>
      )}
      {linking.error && (
        <p role="alert" className="text-xs text-crit">
          {linking.error}
        </p>
      )}
    </section>
  );
}
