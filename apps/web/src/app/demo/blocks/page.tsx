import { BlockLibrary } from "@/components/blocks/block-library";

/** The Block library on the demo: Northbeam's sample blocks, and any saved from the Editor in this tab (both held in the browser, lib/blocks/demo.ts). */
export default function DemoBlocksPage() {
  return <BlockLibrary blocks={[]} mode="demo" newHref={`/demo/edit?mode=block&from=${encodeURIComponent("/demo/blocks")}`} />;
}
