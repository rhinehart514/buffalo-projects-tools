// pnpm catalog:verify — read every official catalog page, write the typed
// drift report the MCP server ships, and exit 1 when anything drifted.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { opportunities } from "../src/catalog.js";
import { catalogVerification } from "../src/catalog-evidence.js";
import { verifyCatalog } from "../src/catalog-verifier.js";

const reportPath = fileURLToPath(new URL("../src/catalog-verification.json", import.meta.url));

const { report, rejections } = await verifyCatalog(opportunities, {
  previous: catalogVerification,
});
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

for (const entry of report.entries) {
  const pages = entry.pages.map((page) => `${page.role} ${page.httpStatus ?? "error"}`).join(", ");
  process.stdout.write(
    `${entry.drift.length ? "DRIFT" : "ok   "} ${entry.id} [${pages}] status=${entry.observed.status} deadline=${entry.observed.deadline ?? "-"} evidence=${entry.evidence.length} rejected=${entry.rejectedFindingCount}\n`,
  );
  for (const drift of entry.drift) process.stdout.write(`      ${drift.kind}: ${drift.detail}\n`);
  for (const evidence of entry.evidence) {
    process.stdout.write(`      ${evidence.field}=${evidence.value} "${evidence.quote}"\n`);
  }
}
for (const rejection of rejections) process.stdout.write(`rejected ${rejection}\n`);

const drifted = report.entries.filter((entry) => entry.drift.length > 0).length;
process.stdout.write(
  `\n${report.entries.length} entries, ${drifted} with drift, ${rejections.length} rejected findings. Wrote ${reportPath}\n`,
);
process.exitCode = drifted > 0 ? 1 : 0;
