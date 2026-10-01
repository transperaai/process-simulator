import { BlockLibrary } from "@/components/blocks/block-library";
import { demoBlocks } from "@/lib/blocks/demo";

/** The Block library on the demo: Northbeam's sample blocks, and any saved from the Editor in this tab. */
export default function DemoBlocksPage() {
  return <BlockLibrary blocks={demoBlocks()} mode="demo" newHref={`/demo/edit?mode=block&from=${encodeURIComponent("/demo/blocks")}`} />;
}
