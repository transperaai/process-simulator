import { processesOf } from "@transpera-flow/db";
import { ProcessesList } from "@/components/shell/placeholders";
import { demoBundle } from "@/lib/sources/demo";

/** Northbeam's processes, each opening its map on the demo (issue #98). */
export default function DemoProcessesPage() {
  const pipeline = demoBundle();
  const processes = processesOf(pipeline).map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    href: p.id === pipeline.process.id ? "/demo" : `/demo?process=${p.id}`,
  }));
  return <ProcessesList processes={processes} />;
}
