import type { CandidatePassport } from "./candidate.js";
import { searchLiveJobs } from "./jobs.js";
import { rankJobs, type JobRankingPreferences } from "./ranking.js";
import {
  loadCandidateProfile,
  loadJobScout,
  recordJobScoutRun,
} from "./storage.js";

type Fetcher = typeof fetch;

export async function runJobScout(
  input: {
    searchId: string;
    ranking?: JobRankingPreferences | undefined;
  },
  options: { dataDir?: string | undefined; fetcher?: Fetcher | undefined } = {},
) {
  const scout = await loadJobScout(input.searchId, options.dataDir);
  const startedAt = new Date().toISOString();
  const result = await searchLiveJobs(
    {
      ...scout.filters,
      ...(scout.lastRunAt ? { newSince: scout.lastRunAt } : {}),
      limit: scout.filters.limit ?? 50,
    },
    options.fetcher ?? fetch,
  );
  let passport: CandidatePassport | null = null;
  if (scout.profileId) {
    passport = (await loadCandidateProfile(scout.profileId, options.dataDir)).passport;
  }
  const ranking = passport
    ? rankJobs(passport, result.jobs, { limit: 5, ...input.ranking })
    : null;
  await recordJobScoutRun(
    scout.searchId,
    result.jobs.map((job) => job.id),
    startedAt,
    options.dataDir,
  );

  return {
    version: "buffalo-job-scout-run/v1",
    search: {
      id: scout.searchId,
      name: scout.name,
      previousRunAt: scout.lastRunAt,
      ranAt: startedAt,
      filters: scout.filters,
    },
    jobs: result.jobs,
    ranking,
    coverage: result.coverage,
    pagination: result.pagination,
    noNewMatches: result.jobs.length === 0,
    scheduleHandoff: {
      capability: "host-provided-scheduling",
      instruction:
        "To run this automatically, schedule the MCP host to call buffalo.run_job_scout with this searchId. The MCP stores the last successful run time and returns only newer indexed jobs on later runs.",
      note:
        "The MCP does not install a background service or scheduler. Claude, Codex, or another host owns recurring execution and notifications.",
    },
  };
}
