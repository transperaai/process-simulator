// Regenerates supabase/seed.sql from the fixtures.
import { writeFileSync } from "node:fs";
import { northbeamAccess, northbeamBundle, northbeamScenarios } from "../src/fixtures/northbeam.ts";
import { seedSql } from "../src/seed.ts";

const path = new URL("../supabase/seed.sql", import.meta.url);
writeFileSync(path, seedSql([northbeamBundle()], [northbeamAccess()], northbeamScenarios()));
console.log(`Wrote ${path.pathname}`);
