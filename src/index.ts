import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { opportunities } from "./catalog.js";
import { createBuffaloServer, packageVersion } from "./server.js";

export { createBuffaloServer, packageVersion, toolHandlers } from "./server.js";
export { getOpportunity, opportunities } from "./catalog.js";
export { searchOpportunities } from "./matcher.js";
export { prepareRegistration, reviewSubmission } from "./registration.js";
export {
  buildCandidatePassport,
  prepareJobApplications,
  reviewJobApplication,
} from "./candidate.js";
export {
  buffaloJobsApiUrl,
  buffaloJobsWebUrl,
  resolveLiveJobs,
  searchLiveJobs,
} from "./jobs.js";

export async function runStdioServer(): Promise<void> {
  const server = createBuffaloServer();
  await server.connect(new StdioServerTransport());
}

function invokedAsBin(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedAsBin()) {
  if (process.argv.includes("--check")) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        name: "buffalo-projects-tools",
        version: packageVersion,
        transport: "stdio",
        accountRequired: false,
        catalogEntries: opportunities.length,
        liveJobSource: "https://buffaloprojects.com/api/jobs",
        tools: 8,
      })}\n`,
    );
  } else if (process.argv.includes("--version")) {
    process.stdout.write(`${packageVersion}\n`);
  } else {
    await runStdioServer();
  }
}
