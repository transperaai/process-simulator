// The process map on a bare page, for the browser tests in ../map-browser.test.ts. Bundled by esbuild and
// driven through `window.mountMap` and `window.mapApi`; nothing here ships.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { northbeamStepIds } from "@transpera-flow/db";
import { NO_SELECTION, ProcessCanvas, type Selection } from "@/components/process-canvas";
import { DEMO_GROUP_IDS, withDemoGroups } from "@/lib/demo/nested";
import { addStep } from "@/lib/editor/commands";
import { ProcessEditor } from "@/lib/editor/editor";
import { MemoryStore } from "@/lib/editor/store";
import { demoBundle } from "@/lib/sources/demo";

export interface HarnessOptions {
  editable: boolean;
  nested: boolean;
  /** The open groups live here and are handed to the map (`expanded`), as two maps sharing them would. */
  controlled: boolean;
  highlight: string[] | null;
}

declare global {
  interface Window {
    mountMap: (options: HarnessOptions) => void;
    mapApi: {
      setHighlight: (ids: string[] | null) => void;
      setOpen: (ids: string[]) => void;
      getOpen: () => string[];
      addStep: () => void;
    };
    mapIds: typeof northbeamStepIds;
    groupIds: typeof DEMO_GROUP_IDS;
  }
}

const never = () => () => undefined;

function Harness({ options }: { options: HarnessOptions }) {
  const base = useMemo(() => (options.nested ? withDemoGroups(demoBundle()) : demoBundle()), [options.nested]);
  const editor = useMemo(() => (options.editable ? new ProcessEditor(base, new MemoryStore(base)) : null), [base, options.editable]);
  const state = useSyncExternalStore(editor ? editor.subscribe : never, editor ? editor.getState : () => null, () => null);
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [highlight, setHighlight] = useState(options.highlight);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    window.mapApi = {
      setHighlight,
      setOpen: (ids) => setOpen(new Set(ids)),
      getOpen: () => [...open],
      addStep: () => editor?.run((b) => addStep(b, { kind: "task", x: 3200, y: 900 }).edit),
    };
  }, [open, editor]);
  return (
    // Where the app puts the map: an editor's map fills a flex panel; a read-only one sits in a block, as wide as the page.
    // (In a bare flex row a read-only map shrinks to its toolbar, and the "drag the map" hint it adds after framing widens
    // that toolbar, so the panel resizes and the map refits at a time that depends on load: the flake in #99's test.)
    <div style={options.editable ? { width: 1300, height: 560, display: "flex" } : { width: 1300 }}>
      <ProcessCanvas
        bundle={state?.bundle ?? base}
        editor={editor}
        editorState={state}
        selection={selection}
        onSelectionChange={setSelection}
        highlight={highlight}
        expanded={options.controlled ? open : undefined}
        onExpandedChange={options.controlled ? setOpen : undefined}
        showPlayback={false}
        stepExtras={() => ({ insights: ["An insight"], issues: ["An issue"] })}
      />
    </div>
  );
}

window.mapIds = northbeamStepIds;
window.groupIds = DEMO_GROUP_IDS;
window.mountMap = (options) => {
  const el = document.getElementById("root")!;
  createRoot(el).render(<Harness options={options} />);
};
