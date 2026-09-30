"use client";

// Who else is on this process, and what they just changed (issue #10, PRD
// §4.1). On the demo, also the controls for a simulated colleague.

import { useState } from "react";
import { UserRoundPlus } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DemoColleague } from "@/lib/realtime/demo-colleague";
import type { RealtimeState, RealtimeSync } from "@/lib/realtime/sync";
import type { Present, Viewer } from "@/lib/realtime/transport";

/** One entry per person (their tabs merged): drafts win over live, as that's where they can change things. */
function people(others: Present[], me: Viewer | null): { key: string; name: string; view: "live" | "draft"; self: boolean }[] {
  const byUser = new Map<string, { key: string; name: string; view: "live" | "draft"; self: boolean }>();
  for (const p of others) {
    const self = me !== null && p.userId === me.userId;
    const seen = byUser.get(p.userId);
    if (seen) {
      if (p.view === "draft") seen.view = "draft";
      continue;
    }
    byUser.set(p.userId, { key: p.key, name: self ? "You, in another tab" : p.name, view: p.view, self });
  }
  return [...byUser.values()];
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export function PresenceBar({
  sync,
  state,
  me,
  processName,
  colleague,
  selectedStep,
  variant = "card",
}: {
  sync: RealtimeSync | null;
  state: RealtimeState;
  me: Viewer | null;
  processName: string;
  colleague: DemoColleague | null;
  /** The step selected on the map, which the simulated colleague edits if asked. */
  selectedStep: string | null;
  /** `compact` is one quiet row for the map's top bar; `card` the full boxed bar. */
  variant?: "card" | "compact";
}) {
  // The colleague controls' last message lives here, not in the popover: it stays open or closed without losing it.
  const [last, setLast] = useState<string | null>(null);
  if (!sync) return null;
  const list = people(state.others, me);
  const latest = state.activity[0];
  const sentence = list.length
    ? list.map((p) => `${p.name} is viewing ${processName} (${p.view === "draft" ? "the draft" : "live"})`).join("; ")
    : `Nobody else is viewing ${processName}.`;
  const statusText = state.status === "live" ? "Live updates" : state.status === "connecting" ? "Connecting…" : "Offline: changes by others show when you reconnect";
  if (variant === "compact") {
    const shown = list.slice(0, 3);
    return (
      <section aria-label="Who else is here" className="flex min-w-0 items-center gap-2 text-xs">
        <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground" title={statusTitle(state.status)}>
          <span aria-hidden className={`inline-block size-2 rounded-full ${state.status === "live" ? "bg-good" : state.status === "connecting" ? "bg-warn" : "bg-crit"}`} />
          <span className="sr-only xl:not-sr-only">{statusText}</span>
        </span>
        <ul aria-label="People viewing this process" className="flex shrink-0 items-center -space-x-1.5">
          {shown.map((p) => (
            <li key={p.key}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Avatar size="sm" className="ring-2 ring-background" tabIndex={0} aria-label={`${p.name}, ${p.view === "draft" ? "draft" : "live"}`}>
                    <AvatarFallback className="bg-accent text-2xs font-semibold text-accent-fg">{initials(p.name)}</AvatarFallback>
                  </Avatar>
                </TooltipTrigger>
                <TooltipContent>{`${p.name} is viewing ${processName} (${p.view === "draft" ? "the draft" : "live"})`}</TooltipContent>
              </Tooltip>
            </li>
          ))}
          {list.length > shown.length && (
            <li className="pl-2.5 text-muted-foreground" title={list.slice(3).map((p) => p.name).join(", ")}>
              +{list.length - shown.length}
            </li>
          )}
        </ul>
        <p className="sr-only" aria-live="polite">
          {sentence}
        </p>
        {latest && (
          <p className="hidden max-w-56 truncate text-muted-foreground 2xl:block" aria-live="polite" title={sync.activityText(latest)}>
            {sync.activityText(latest)} · {ago(latest.at)}
          </p>
        )}
        {colleague && <ColleagueMenu colleague={colleague} selectedStep={selectedStep} last={last} onLast={setLast} />}
      </section>
    );
  }
  return (
    <section aria-label="Who else is here" className="flex flex-col gap-1.5 rounded-token border border-line bg-panel px-2 py-1.5 text-xs shadow-token">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-fg-2" title={statusTitle(state.status)}>
          <span aria-hidden className={`inline-block size-2 rounded-full ${state.status === "live" ? "bg-good" : state.status === "connecting" ? "bg-warn" : "bg-crit"}`} />
          {statusText}
        </span>
        <ul aria-label="People viewing this process" className="flex flex-wrap items-center gap-1.5">
          {list.map((p) => (
            <li key={p.key} className="flex items-center gap-1 rounded-full border border-line bg-panel-2 py-0.5 pr-2 pl-0.5" title={`${p.name} is viewing ${processName} (${p.view === "draft" ? "the draft" : "live"})`}>
              <span aria-hidden className="grid size-5 place-items-center rounded-full bg-accent text-[10px] font-bold text-accent-fg">
                {initials(p.name)}
              </span>
              <span className="font-semibold">{p.name}</span>
              <span className="text-fg-3">· {p.view === "draft" ? "draft" : "live"}</span>
            </li>
          ))}
        </ul>
        <p className="sr-only" aria-live="polite">
          {sentence}
        </p>
        {list.length === 0 && <span className="text-fg-3">Nobody else is here.</span>}
        {latest && (
          <p className="ml-auto truncate text-fg-2" aria-live="polite" title={sync.activityText(latest)}>
            {sync.activityText(latest)} · {ago(latest.at)}
          </p>
        )}
      </div>
      {colleague && <ColleagueControls colleague={colleague} selectedStep={selectedStep} last={last} onLast={setLast} />}
    </section>
  );
}

function statusTitle(status: RealtimeState["status"]): string {
  return status === "live" ? "Changes others save appear here within seconds." : status === "connecting" ? "Joining…" : "Not connected.";
}

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return s < 10 ? "just now" : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
}

/**
 * Demo only, in the compact bar: the colleague controls in a popover. A click on the map doesn't close it (you select a
 * step for Tom to edit); its message is kept by the caller, so closing it doesn't lose the 5-second countdown's.
 */
function ColleagueMenu({
  colleague,
  selectedStep,
  last,
  onLast,
}: {
  colleague: DemoColleague;
  selectedStep: string | null;
  last: string | null;
  onLast: (message: string | null) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="shrink-0">
          <UserRoundPlus /> Colleague
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80" onInteractOutside={(e) => e.preventDefault()}>
        <ColleagueControls colleague={colleague} selectedStep={selectedStep} last={last} onLast={onLast} />
      </PopoverContent>
    </Popover>
  );
}

/** Demo only: a pretend colleague, "Tom", in the same process. */
function ColleagueControls({
  colleague,
  selectedStep,
  last,
  onLast,
}: {
  colleague: DemoColleague;
  selectedStep: string | null;
  last: string | null;
  onLast: (message: string | null) => void;
}) {
  // Re-read on each render: Tom stops racing once he has beaten a save.
  const [, rerender] = useState(0);
  const present = colleague.present;
  const racing = colleague.isRacing;
  return (
    <div role="group" aria-label="Simulate a colleague" className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1 font-semibold">
        <input
          type="checkbox"
          checked={present}
          onChange={(e) => {
            if (e.target.checked) colleague.join();
            else colleague.leave();
            rerender((n) => n + 1);
          }}
        />
        Simulate a colleague (Tom)
      </label>
      {present && (
        <>
          <Button variant="outline" size="sm" onClick={async () => onLast(await colleague.editSomething(selectedStep ?? undefined))}>
            {selectedStep ? "Tom edits the selected step" : "Tom edits a step"}
          </Button>
          {selectedStep && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Time to start typing a new hands-on time for the step, to see his save arrive mid-edit.
                onLast("In 5 seconds Tom changes this step's hands-on time: start typing a new one in the inspector.");
                setTimeout(async () => onLast(await colleague.editSomething(selectedStep)), 5000);
              }}
            >
              …in 5 s
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            aria-pressed={racing}
            className={racing ? "border-warn bg-warn-soft" : ""}
            onClick={() => {
              colleague.race(!racing);
              rerender((n) => n + 1);
            }}
          >
            {racing ? "Tom will beat your next save…" : "Tom races your next save"}
          </Button>
          <span className="w-full text-muted-foreground">{last ?? "Tom saves through the same in-memory database; his changes arrive like anyone's."}</span>
        </>
      )}
    </div>
  );
}
