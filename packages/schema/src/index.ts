import { z } from "zod";

export const projectCategorySchema = z.enum([
  "software",
  "startup",
  "design",
  "research",
  "ai-workflow",
  "business",
  "community",
  "indie",
  "open-source",
  "creative",
  "small-business",
  "food-bev",
  "retail",
  "services",
  "nonprofit",
  "other",
]);

export const projectStageSchema = z.enum([
  "idea",
  "research",
  "planning",
  "building",
  "testing",
  "launching",
  "scaling",
]);

export const projectPrivacySchema = z.enum([
  "private",
  "link",
  "public",
  "encrypted",
]);

export const workEntrySourceSchema = z.enum([
  "github_commit",
  "github_release",
  "manual",
  "mcp",
  "cli",
  "agent",
]);

export const rawWorkEventSourceSchema = z.enum([
  "github_push",
  "github_commit",
  "github_release",
  "mcp_call",
  "cli_push",
  "manual",
  "artifact_parse",
]);

export const rawWorkEventExtractionStatusSchema = z.enum([
  "pending",
  "extracted",
  "ignored",
  "needs_review",
]);

export const workEntryContributionStatusSchema = z.enum([
  "owned",
  "self_logged_external",
  "owner_requested",
  "owner_email_verified",
  "owner_claimed_project",
  "contribution_confirmed",
  "declined",
  "expired",
  "revoked",
]);

export const rawWorkEventSchema = z.object({
  id: z.string().min(1),
  builderId: z.string().min(1),
  source: rawWorkEventSourceSchema,
  sourceRef: z.string().min(1),
  occurredAt: z.coerce.date(),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  projectId: z.string().optional(),
  externalProjectRefId: z.string().optional(),
  contributionRequestId: z.string().optional(),
  rawTitle: z.string().optional(),
  rawSummary: z.string().optional(),
  rawUrl: z.string().url().optional(),
  providerData: z.record(z.string(), z.unknown()).optional(),
  extractionStatus: rawWorkEventExtractionStatusSchema,
  visibility: z.literal("private"),
  createdAt: z.coerce.date(),
});

export const workEntryVisibilitySchema = z.enum(["public", "private"]);

// Optional milestone-style narrative folded onto a work entry during the
// storage convergence (WORK-SPEC §2.1). When present, the entry is a
// "milestone-grade" update rather than a bare log line.
export const workEntryNarrativeSchema = z.object({
  shipped: z.string(),
  learned: z.string(),
  next: z.string(),
});

export const workEntryMetricSchema = z.object({
  label: z.string().min(1),
  value: z.number(),
  unit: z.enum(["usd", "count", "percent"]),
});

export const workEntryGithubDataSchema = z.object({
  sha: z.string().optional(),
  repoName: z.string(),
  repoUrl: z.string(),
  message: z.string().optional(),
  releaseTag: z.string().optional(),
  releaseName: z.string().optional(),
});

// The converged work-entry contract — the single stored shape behind the
// record's timeline. Milestones fold in via the optional narrative/metric/
// evidence fields; nothing required was added, so plain log entries written
// before convergence stay valid.
export const workEntrySchema = z.object({
  id: z.string().min(1),
  builderId: z.string().min(1),
  projectId: z.string().optional(),
  rawEventIds: z.array(z.string()).optional(),
  externalProjectRefId: z.string().optional(),
  contributionRequestId: z.string().optional(),
  contributionStatus: workEntryContributionStatusSchema.optional(),
  extractionConfidence: z.enum(["high", "medium", "low"]).optional(),
  source: workEntrySourceSchema,
  githubData: workEntryGithubDataSchema.optional(),
  annotation: z.string().optional(),
  title: z.string(),
  visibility: workEntryVisibilitySchema,
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  narrative: workEntryNarrativeSchema.optional(),
  metric: workEntryMetricSchema.optional(),
  evidenceLinks: z.array(z.string()).optional(),
  photoUrls: z.array(z.string()).optional(),
  sourceRef: z.string().optional(),
  agentDrafted: z.boolean().optional(),
  editDiffPct: z.number().optional(),
  occurredAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});

export const projectRoleSchema = z.enum([
  "lead",
  "developer",
  "designer",
  "business",
  "other",
]);

export const projectTemplateTypeSchema = z.enum([
  "engineering",
  "lab",
  "business-case",
  "creative",
  "community",
  "hackathon",
  "generic",
]);

export const skillEvidenceSchema = z.object({
  skill: z.string().min(1),
  evidence: z.string().min(1),
  source: z
    .enum(["manual", "github", "milestone", "vouch", "metric"])
    .optional(),
});

export const projectEvidenceSchema = z.object({
  id: z.string().min(1).optional(),
  type: z
    .enum(["screenshot", "repo", "demo", "loom", "pdf", "doc", "metric", "link", "file"])
    .default("link"),
  source: z.string().min(1),
  caption: z.string().optional(),
  milestoneId: z.string().optional(),
  createdAt: z.coerce.date().optional(),
});

export const projectMilestoneSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  note: z.string().optional(),
  date: z.string().min(1),
});

export const evidenceBindingsSchema = z.object({
  githubRepo: z.string().optional(),
  squareCatalogCategory: z.string().optional(),
  instagramHandle: z.string().optional(),
  substackUrl: z.string().url().optional(),
  customUrls: z.array(z.string().url()).optional(),
});

export const projectSchema = z.object({
  id: z.string().min(1),
  builderId: z.string().min(1),
  slug: z.string().optional(),
  title: z.string().min(1),
  description: z.string().default(""),
  templateType: projectTemplateTypeSchema.optional(),
  privacy: projectPrivacySchema.default("private"),
  stage: projectStageSchema.optional(),
  category: projectCategorySchema.optional(),
  primarySkills: z.array(z.string().min(1)).optional(),
  currentAsk: z.string().optional(),
  proofStatements: z.array(z.string().min(1)).optional(),
  skillEvidence: z.array(skillEvidenceSchema).optional(),
  projectUrl: z.string().url().optional(),
  githubRepoUrl: z.string().url().optional(),
  coverImageUrl: z.string().url().optional(),
  metricLabel: z.string().optional(),
  metricValue: z.string().optional(),
  evidence: z.array(projectEvidenceSchema).optional(),
  milestones: z.array(projectMilestoneSchema).optional(),
  evidenceBindings: evidenceBindingsSchema.optional(),
  // Ownership: builderId is the storage home; coOwnerIds are equal co-owners.
  collaboratorIds: z.array(z.string()).optional(),
  coOwnerIds: z.array(z.string()).optional(),
  ownerContributions: z.record(z.string(), z.string()).optional(),
  ownerPageHidden: z.array(z.string()).optional(),
  createdAt: z.coerce.date(),
  lastActiveAt: z.coerce.date(),
});

export const projectJsonSchema = z.toJSONSchema(projectSchema, {
  target: "draft-7",
  unrepresentable: "any",
});

export const profileSchema = z.object({
  id: z.string().min(1),
  handle: z.string().min(2),
  name: z.string().min(1),
  oneLiner: z.string().optional(),
  bio: z.string().optional(),
  school: z.string().optional(),
  major: z.string().optional(),
  gradYear: z.string().optional(),
  avatarUrl: z.string().url().optional(),
});

export const vouchSchema = z.object({
  id: z.string().min(1),
  builderId: z.string().min(1),
  projectId: z.string().optional(),
  authorName: z.string().min(1),
  authorRole: z.string().optional(),
  text: z.string().min(1),
  completedAt: z.coerce.date().optional(),
});

export type ProjectCategory = z.infer<typeof projectCategorySchema>;
export type ProjectStage = z.infer<typeof projectStageSchema>;
export type ProjectPrivacy = z.infer<typeof projectPrivacySchema>;
export type WorkEntrySource = z.infer<typeof workEntrySourceSchema>;
export type RawWorkEventSource = z.infer<typeof rawWorkEventSourceSchema>;
export type RawWorkEvent = z.infer<typeof rawWorkEventSchema>;
export type WorkEntryContributionStatus = z.infer<
  typeof workEntryContributionStatusSchema
>;
export type ProjectRole = z.infer<typeof projectRoleSchema>;
export type ProjectTemplateType = z.infer<typeof projectTemplateTypeSchema>;
export type SkillEvidence = z.infer<typeof skillEvidenceSchema>;
export type ProjectEvidence = z.infer<typeof projectEvidenceSchema>;
export type ProjectMilestone = z.infer<typeof projectMilestoneSchema>;
export type EvidenceBindings = z.infer<typeof evidenceBindingsSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Vouch = z.infer<typeof vouchSchema>;
