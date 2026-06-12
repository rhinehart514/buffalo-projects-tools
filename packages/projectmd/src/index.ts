import {
  projectCategorySchema,
  projectStageSchema,
  projectTemplateTypeSchema,
  type Project,
  type ProjectCategory,
  type ProjectEvidence,
  type ProjectMilestone,
  type ProjectStage,
  type ProjectTemplateType,
  type SkillEvidence,
} from "@buffalo/schema";

export type ProjectMarkdownHintDimension =
  | "clarity"
  | "evidence"
  | "specificity"
  | "recency"
  | "skills"
  | "outcomes";

export const projectTemplateTypes = [
  "engineering",
  "lab",
  "business-case",
  "creative",
  "community",
  "hackathon",
  "generic",
] as const satisfies readonly ProjectTemplateType[];

interface TemplateDefinition {
  label: string;
  category?: ProjectCategory;
  sections: string[];
  prompts: string[];
}

export interface ProjectExample {
  id: string;
  templateType: ProjectTemplateType;
  title: string;
  summary: string;
  markdown: string;
}

export const projectTemplates: Record<ProjectTemplateType, TemplateDefinition> =
  {
    engineering: {
      label: "Engineering",
      category: "software",
      sections: ["Stack", "Architecture notes", "Technical decisions"],
      prompts: [
        "What problem does the software solve, and who uses it?",
        "What did you personally build?",
        "What can someone inspect first: demo, repo, screenshot, or commit?",
      ],
    },
    lab: {
      label: "Lab / research",
      category: "research",
      sections: ["Research question", "Method", "Findings"],
      prompts: [
        "What question did the work investigate?",
        "What method or dataset makes the work credible?",
        "What artifact can someone inspect: poster, paper, notebook, deck, or data?",
      ],
    },
    "business-case": {
      label: "Business case",
      category: "business",
      sections: ["Customer", "Offer", "Signal"],
      prompts: [
        "Who is the customer or stakeholder?",
        "What decision, offer, or operation did you improve?",
        "What signal exists: revenue, orders, reviews, savings, or feedback?",
      ],
    },
    creative: {
      label: "Creative",
      category: "creative",
      sections: ["Concept", "Process", "Final artifact"],
      prompts: [
        "What did you make?",
        "What choices shaped the final artifact?",
        "Where can someone inspect the work?",
      ],
    },
    community: {
      label: "Community",
      category: "community",
      sections: ["Audience", "Partners", "Impact"],
      prompts: [
        "Who participated or benefited?",
        "What did you organize, build, or lead?",
        "What evidence shows participation or impact?",
      ],
    },
    hackathon: {
      label: "Hackathon",
      category: "software",
      sections: ["Problem", "Build", "Demo"],
      prompts: [
        "What did the team build during the event?",
        "What was your contribution?",
        "What demo, repo, slide, or judging feedback survived the weekend?",
      ],
    },
    generic: {
      label: "Generic",
      sections: ["Context", "Contribution", "Outcome"],
      prompts: [
        "What did you build or do?",
        "Why did it matter?",
        "What proof can someone inspect?",
      ],
    },
  };

export const projectExamples: Record<ProjectTemplateType, ProjectExample[]> = {
  engineering: [
    {
      id: "engineering-study-planner",
      templateType: "engineering",
      title: "Study Planner Dashboard",
      summary:
        "A Next.js dashboard that turns course deadlines into a weekly study plan.",
      markdown: [
        "# Study Planner Dashboard",
        "",
        "## Summary",
        "I built a Next.js dashboard for classmates who were missing assignment deadlines because course calendars were spread across three different systems.",
        "",
        "## What this shows",
        "- Built the import flow, deadline normalization, and weekly planning interface.",
        "- Tested the planner with 12 classmates and used their feedback to simplify onboarding.",
        "",
        "## Evidence",
        "- https://github.com/example/study-planner - Repository with import parser and dashboard components.",
        "- screenshots/study-planner-week.png - Screenshot of the weekly planning view.",
        "",
        "## Milestones",
        "- 2026-03-08 - Imported assignments from two course calendar formats.",
        "- 2026-03-22 - Shipped the dashboard to a small class pilot.",
        "",
        "## Skills demonstrated",
        "- React: built the dashboard and onboarding flow.",
        "- Data modeling: normalized assignments from multiple calendar formats.",
        "- User testing: changed onboarding after feedback from classmates.",
        "",
        "## Current ask",
        "I want feedback on whether the project is strong enough to discuss in software internship interviews.",
        "",
      ].join("\n"),
    },
  ],
  lab: [
    {
      id: "lab-water-quality",
      templateType: "lab",
      title: "Campus Water Quality Study",
      summary:
        "A lab project comparing nitrate levels across campus water collection sites.",
      markdown: [
        "# Campus Water Quality Study",
        "",
        "## Summary",
        "I investigated nitrate levels across five campus water collection sites and built a reproducible notebook for cleaning, plotting, and explaining the results.",
        "",
        "## What this shows",
        "- Designed a repeatable sampling method and documented constraints in the notebook.",
        "- Found one outlier site and wrote up a possible explanation for follow-up testing.",
        "",
        "## Evidence",
        "- notebooks/water-quality-analysis.ipynb - Analysis notebook.",
        "- artifacts/water-quality-poster.pdf - Final poster.",
        "",
        "## Milestones",
        "- 2026-02-15 - Completed first collection pass across all five sites.",
        "- 2026-03-01 - Presented findings in lab section.",
        "",
        "## Skills demonstrated",
        "- Experimental design: planned sampling sites and controls.",
        "- Data analysis: cleaned readings and visualized site differences.",
        "- Scientific communication: turned findings into a poster.",
        "",
        "## Current ask",
        "I want help making the methods and findings clearer for a research assistant application.",
        "",
      ].join("\n"),
    },
  ],
  "business-case": [
    {
      id: "business-case-campus-cafe",
      templateType: "business-case",
      title: "Campus Cafe Pickup Case",
      summary:
        "A business case for reducing pickup delays at a student-run cafe.",
      markdown: [
        "# Campus Cafe Pickup Case",
        "",
        "## Summary",
        "I analyzed pickup delays at a student-run cafe and proposed an order batching change that could reduce the lunch rush line without adding staff.",
        "",
        "## What this shows",
        "- Mapped the current order flow and identified the handoff bottleneck.",
        "- Estimated a 15 minute reduction in peak backlog using two weeks of order timestamps.",
        "",
        "## Evidence",
        "- artifacts/cafe-pickup-case.pdf - Case write-up and recommendation.",
        "- data/order-timestamps.csv - Anonymized timestamp sample.",
        "",
        "## Milestones",
        "- 2026-04-05 - Interviewed three shift leads about the lunch rush.",
        "- 2026-04-18 - Delivered recommendation deck to the cafe manager.",
        "",
        "## Skills demonstrated",
        "- Operations analysis: mapped the pickup workflow and bottlenecks.",
        "- Business communication: wrote a recommendation deck for a manager.",
        "- Quantitative reasoning: used order timestamps to estimate impact.",
        "",
        "## Current ask",
        "I want to adapt this project for consulting and operations internship applications.",
        "",
      ].join("\n"),
    },
  ],
  creative: [
    {
      id: "creative-short-film",
      templateType: "creative",
      title: "Dorm Room Short Film",
      summary:
        "A short film made with practical lighting and a three-person crew.",
      markdown: [
        "# Dorm Room Short Film",
        "",
        "## Summary",
        "I wrote, shot, and edited a four-minute short film using practical lighting and a three-person crew in a dorm room.",
        "",
        "## What this shows",
        "- Turned a constrained location into a finished visual story.",
        "- Managed shot planning, sound, and editing across a two-week production cycle.",
        "",
        "## Evidence",
        "- https://example.com/dorm-room-short - Final cut.",
        "- artifacts/shot-list.pdf - Shot list and production notes.",
        "",
        "## Milestones",
        "- 2026-01-12 - Locked script and shot list.",
        "- 2026-01-28 - Published final cut for class critique.",
        "",
        "## Skills demonstrated",
        "- Directing: coordinated actors, blocking, and visual tone.",
        "- Editing: cut the final film and mixed dialogue.",
        "- Production planning: built a feasible shoot plan for a small crew.",
        "",
        "## Current ask",
        "I want feedback on how to present the project for a media portfolio.",
        "",
      ].join("\n"),
    },
  ],
  community: [
    {
      id: "community-food-drive",
      templateType: "community",
      title: "Residence Hall Food Drive",
      summary:
        "A community project that coordinated donations across three residence halls.",
      markdown: [
        "# Residence Hall Food Drive",
        "",
        "## Summary",
        "I coordinated a residence hall food drive across three buildings and created the volunteer schedule, donation tracking sheet, and partner handoff process.",
        "",
        "## What this shows",
        "- Recruited 18 volunteers and collected 420 pantry items over nine days.",
        "- Built a tracking process that made partner pickup faster and less error-prone.",
        "",
        "## Evidence",
        "- photos/food-drive-table.jpg - Collection table photo.",
        "- artifacts/donation-tracker.pdf - Donation tracker summary.",
        "",
        "## Milestones",
        "- 2026-02-02 - Confirmed partner pickup requirements.",
        "- 2026-02-14 - Completed final pickup and volunteer debrief.",
        "",
        "## Skills demonstrated",
        "- Community organizing: recruited volunteers and coordinated buildings.",
        "- Operations: created the schedule and handoff checklist.",
        "- Impact tracking: documented items collected and partner pickup.",
        "",
        "## Current ask",
        "I want help turning this into a strong leadership example.",
        "",
      ].join("\n"),
    },
  ],
  hackathon: [
    {
      id: "hackathon-campus-companion",
      templateType: "hackathon",
      title: "Campus Companion",
      summary:
        "A hackathon app that answers first-year student questions from campus resources.",
      markdown: [
        "# Campus Companion",
        "",
        "## Summary",
        "At a weekend hackathon, my team built a campus resource assistant that answered first-year student questions using a curated set of handbook and advising links.",
        "",
        "## What this shows",
        "- Built the retrieval flow and source citation display during the hackathon.",
        "- Demoed the assistant to judges and placed second in the student life category.",
        "",
        "## Evidence",
        "- https://github.com/example/campus-companion - Hackathon repo.",
        "- artifacts/demo-slides.pdf - Final demo slides.",
        "",
        "## Milestones",
        "- 2026-04-11 - Built working retrieval demo by midnight.",
        "- 2026-04-12 - Presented to judges and collected feedback.",
        "",
        "## Skills demonstrated",
        "- AI workflow: connected campus sources to generated answers with citations.",
        "- Frontend engineering: built the question and answer interface.",
        "- Team execution: shipped a judged demo in one weekend.",
        "",
        "## Current ask",
        "I want to preserve this project while the implementation details are still fresh.",
        "",
      ].join("\n"),
    },
  ],
  generic: [
    {
      id: "generic-independent-project",
      templateType: "generic",
      title: "Independent Project Record",
      summary:
        "A general-purpose example for turning messy work into a credible project page.",
      markdown: [
        "# Independent Project Record",
        "",
        "## Summary",
        "I turned a loosely defined independent project into a documented artifact with a clear summary, dated milestones, evidence, and a reviewer-ready ask.",
        "",
        "## What this shows",
        "- Organized scattered work into a project page someone else can inspect.",
        "- Identified the strongest artifact and connected it to the skill the project demonstrates.",
        "",
        "## Evidence",
        "- artifacts/final-artifact.pdf - Final artifact.",
        "",
        "## Milestones",
        "- 2026-03-10 - Collected project notes and evidence.",
        "- 2026-03-17 - Created the first shareable project page.",
        "",
        "## Skills demonstrated",
        "- Project communication: wrote a clear summary and current ask.",
        "- Reflection: connected work decisions to outcomes.",
        "",
        "## Current ask",
        "I want feedback on what evidence would make this project more credible.",
        "",
      ].join("\n"),
    },
  ],
};

export function examplesForTemplate(
  type: ProjectTemplateType,
): ProjectExample[] {
  return projectExamples[type] ?? [];
}

export function findProjectExample(
  exampleId: string,
): ProjectExample | undefined {
  return Object.values(projectExamples)
    .flat()
    .find((example) => example.id === exampleId);
}

export function blankMarkdownFromExample(
  example: ProjectExample,
  today?: string,
): string {
  return createProjectMarkdownTemplate({
    templateType: example.templateType,
    title: example.title,
    today,
  });
}

function compact(value: string | undefined | null): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function bullet(value: string): string {
  return `- ${compact(value)}`;
}

function cleanUrl(value: string | undefined | null): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value).toString();
  } catch {
    return undefined;
  }
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(compact).filter(Boolean))];
}

function isPlaceholder(value: string): boolean {
  const text = value.trim().toLowerCase();

  return (
    text.startsWith("add ") ||
    text.startsWith("write one sentence") ||
    text.includes("concrete action or artifact")
  );
}

function slugify(value: string): string {
  return compact(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function stripInlineMarkdown(value: string): string {
  return compact(
    value
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"),
  );
}

function headingName(line: string): string | undefined {
  const match = /^(#{1,3})\s+(.+)$/.exec(line.trim());
  return match ? compact(match[2]).toLowerCase() : undefined;
}

function headingLine(markdown: string, names: string[]): number | undefined {
  const normalizedNames = new Set(names.map((name) => name.toLowerCase()));
  const lines = markdown.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const heading = headingName(lines[index] ?? "");

    if (heading && normalizedNames.has(heading)) {
      return index + 1;
    }
  }

  return undefined;
}

export function projectMarkdownLineHint(
  markdown: string,
  dimension: ProjectMarkdownHintDimension,
): number | undefined {
  const hints: Record<ProjectMarkdownHintDimension, string[]> = {
    clarity: ["summary", "current ask", "project", "one-liner"],
    evidence: ["evidence"],
    specificity: ["summary", "what this shows", "context", "contribution"],
    recency: ["milestones", "timeline"],
    skills: ["skills demonstrated", "skills backed by evidence"],
    outcomes: ["what this shows", "outcomes", "proof"],
  };

  return (
    headingLine(markdown, hints[dimension]) ??
    headingLine(markdown, ["summary"]) ??
    1
  );
}

function collectSections(markdown: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current = "root";

  for (const line of markdown.split(/\r?\n/)) {
    const heading = headingName(line);
    if (heading) {
      current = heading;
      if (!sections.has(current)) {
        sections.set(current, []);
      }
      continue;
    }

    const lines = sections.get(current) ?? [];
    lines.push(line);
    sections.set(current, lines);
  }

  return sections;
}

function sectionText(sections: Map<string, string[]>, names: string[]): string {
  for (const name of names) {
    const value = sections.get(name)?.map(stripInlineMarkdown).join(" ").trim();
    if (value) {
      return value;
    }
  }

  return "";
}

function sectionBullets(
  sections: Map<string, string[]>,
  names: string[],
): string[] {
  for (const name of names) {
    const lines = sections.get(name) ?? [];
    const bullets = lines
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+/.test(line))
      .map((line) => stripInlineMarkdown(line.replace(/^[-*]\s+/, "")))
      .filter(Boolean);

    if (bullets.length) {
      return bullets;
    }
  }

  return [];
}

function firstUrl(value: string): string | undefined {
  return value.match(/https?:\/\/[^\s`)]+/)?.[0];
}

function evidenceUrls(sections: Map<string, string[]>): string[] {
  return unique(
    sectionBullets(sections, ["evidence"]).map((line) => firstUrl(line)),
  );
}

function inferEvidenceType(source: string): ProjectEvidence["type"] {
  const lower = source.toLowerCase();

  if (lower.includes("github.com")) {
    return "repo";
  }
  if (lower.includes("loom.com")) {
    return "loom";
  }
  if (lower.endsWith(".pdf")) {
    return "pdf";
  }
  if (/\.(png|jpg|jpeg|gif|webp)$/i.test(lower)) {
    return "screenshot";
  }
  if (/^https?:\/\//i.test(source)) {
    return "link";
  }

  return "file";
}

function sectionEvidence(sections: Map<string, string[]>): ProjectEvidence[] {
  return sectionBullets(sections, ["evidence"])
    .filter((line) => !isPlaceholder(line))
    .map((line, index) => {
      const url = firstUrl(line);
      const source = url ?? line;

      return {
        id: `evidence-${index + 1}`,
        type: inferEvidenceType(source),
        source,
        caption: stripInlineMarkdown(line.replace(source, "")).replace(
          /^[:\s\-\u2014]+/,
          "",
        ),
      };
    })
    .filter((item) => item.source.length > 0);
}

function sectionMilestones(
  sections: Map<string, string[]>,
): ProjectMilestone[] {
  return sectionBullets(sections, ["milestones", "timeline"]).map(
    (line, index) => {
      const dateMatch = /^(\d{4}-\d{2}-\d{2})\s+[-:]\s+(.+)$/.exec(line);

      return {
        id: `milestone-${index + 1}`,
        date: dateMatch?.[1] ?? "",
        title: dateMatch?.[2] ?? line,
      };
    },
  );
}

function sectionSkillEvidence(
  sections: Map<string, string[]>,
): SkillEvidence[] {
  const lines = [
    ...(sections.get("skills backed by evidence") ?? []),
    ...(sections.get("skills demonstrated") ?? []),
  ];
  const evidence: SkillEvidence[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || /^[-|\s]+$/.test(trimmed)) {
      continue;
    }

    const cells = trimmed.split("|").map(stripInlineMarkdown).filter(Boolean);
    const [skill, proof] = cells;

    if (
      !skill ||
      !proof ||
      skill.toLowerCase() === "skill" ||
      proof.toLowerCase() === "evidence"
    ) {
      continue;
    }

    evidence.push({
      skill,
      evidence: proof,
      source: "manual",
    });
  }

  return evidence;
}

function inferCategory(markdown: string): ProjectCategory | undefined {
  const lower = markdown.toLowerCase();
  const candidates: Array<[ProjectCategory, string[]]> = [
    ["research", ["research", "lab", "hypothesis", "method"]],
    ["business", ["business", "market", "financial", "case"]],
    ["design", ["design", "figma", "portfolio", "prototype"]],
    ["community", ["community", "nonprofit", "volunteer"]],
    ["ai-workflow", ["ai workflow", "agent", "prompt"]],
    ["software", ["software", "github", "react", "firebase", "app"]],
  ];

  return candidates.find(([, terms]) =>
    terms.some((term) => lower.includes(term)),
  )?.[0];
}

function buffaloMetadataValue(
  markdown: string,
  key: string,
): string | undefined {
  const block = /<!--\s*buffalo([\s\S]*?)buffalo\s*-->/i.exec(markdown)?.[1];

  if (!block) {
    return undefined;
  }

  const line = block
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.toLowerCase().startsWith(`${key.toLowerCase()}:`));

  return line?.split(":").slice(1).join(":").trim() || undefined;
}

function inferStage(markdown: string): ProjectStage {
  const lower = markdown.toLowerCase();

  if (lower.includes("launched") || lower.includes("deployed")) {
    return "launching";
  }
  if (lower.includes("tested") || lower.includes("validated")) {
    return "testing";
  }
  if (lower.includes("built") || lower.includes("prototype")) {
    return "building";
  }
  if (lower.includes("research")) {
    return "research";
  }

  return "planning";
}

function evidenceLines(project: Project, href?: string | null): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];

  const addLine = (label: string, value: string | undefined | null) => {
    const cleaned = cleanUrl(value);
    if (!cleaned || seen.has(cleaned)) {
      return;
    }
    seen.add(cleaned);
    lines.push(bullet(`${label}: ${cleaned}`));
  };

  addLine("Live work", project.projectUrl);
  addLine("Repository", project.githubRepoUrl);
  addLine("Visual source", project.coverImageUrl);

  for (const url of unique(project.evidenceBindings?.customUrls ?? [])) {
    addLine("Supporting source", url);
  }

  addLine("Buffalo project page", href);

  return lines;
}

export function projectMdFileName(
  project: Pick<Project, "id" | "slug" | "title">,
): string {
  const slug = slugify(project.slug || project.title || project.id);

  return `${slug || "project-page"}.project.md`;
}

export interface ParseProjectMarkdownOptions {
  id?: string;
  builderId?: string;
  now?: Date;
}

export function projectFromMarkdown(
  markdown: string,
  options: ParseProjectMarkdownOptions = {},
): Project {
  const sections = collectSections(markdown);
  const root = sections.get("root") ?? [];
  const h1 = markdown.match(/^#\s+(.+)$/m)?.[1];
  const projectLine =
    sectionText(sections, ["project"]) ||
    root.map(stripInlineMarkdown).find((line) => line.length > 0);
  const parsedTitle =
    stripInlineMarkdown(projectLine || h1 || "Untitled project").split(
      " — ",
    )[0] ?? "Untitled project";
  const title = compact(parsedTitle) || "Untitled project";
  const description =
    sectionText(sections, ["summary", "one-liner"]) ||
    sectionText(sections, ["profile headline"]) ||
    "Add a direct summary of what this project does.";
  const proofStatements = sectionBullets(sections, [
    "what this shows",
    "proof",
    "outcomes",
  ]);
  const primarySkills = sectionBullets(sections, [
    "skills demonstrated",
    "skills backed by evidence",
  ]).map((line) => line.split("|")[0]?.trim() ?? line);
  const skillEvidence = sectionSkillEvidence(sections);
  const urls = evidenceUrls(sections);
  const evidence = sectionEvidence(sections);
  const milestones = sectionMilestones(sections);
  const githubRepoUrl = urls.find((url) => url.includes("github.com"));
  const projectUrl = urls.find((url) => !url.includes("github.com"));
  const parsedTemplateType = projectTemplateTypeSchema.safeParse(
    buffaloMetadataValue(markdown, "template"),
  );
  const parsedCategory = projectCategorySchema.safeParse(
    buffaloMetadataValue(markdown, "category"),
  );
  const category = parsedCategory.success
    ? parsedCategory.data
    : inferCategory(markdown);
  const stage = inferStage(markdown);
  const now = options.now ?? new Date();

  return {
    id: options.id ?? (slugify(title) || "local-project"),
    builderId: options.builderId ?? "local-builder",
    slug: slugify(title),
    title,
    description,
    templateType: parsedTemplateType.success
      ? parsedTemplateType.data
      : undefined,
    privacy: "private",
    stage: projectStageSchema.parse(stage),
    category: category ? projectCategorySchema.parse(category) : undefined,
    primarySkills: unique([
      ...primarySkills,
      ...skillEvidence.map((item) => item.skill),
    ]),
    currentAsk: sectionText(sections, ["current ask", "share use case"]),
    proofStatements,
    skillEvidence,
    projectUrl,
    githubRepoUrl,
    evidence,
    milestones,
    evidenceBindings: {
      customUrls: urls.filter(
        (url) => url !== projectUrl && url !== githubRepoUrl,
      ),
    },
    createdAt: now,
    lastActiveAt: now,
  };
}

export function projectToMarkdown(
  project: Project,
  href?: string | null,
): string {
  const evidence = evidenceLines(project, href);
  const skills = project.skillEvidence?.length
    ? project.skillEvidence.map((item) => `${item.skill}: ${item.evidence}`)
    : (project.primarySkills ?? []);

  return [
    `# ${compact(project.title) || "Project page"}`,
    "",
    "## Summary",
    compact(project.description) ||
      "Add a direct summary of what this project does.",
    "",
    "## What this shows",
    ...(project.proofStatements?.length
      ? project.proofStatements.map(bullet)
      : [bullet("Add one statement explaining what this project shows.")]),
    "",
    "## Evidence",
    ...(evidence.length
      ? evidence
      : [bullet("Add a demo, repo, screenshot, doc, or metric.")]),
    "",
    "## Milestones",
    ...(project.milestones?.length
      ? project.milestones.map((item) =>
          bullet(
            `${item.date} - ${item.title}${item.note ? `: ${item.note}` : ""}`,
          ),
        )
      : [bullet("Add the latest dated update.")]),
    "",
    "## Skills demonstrated",
    ...(skills.length
      ? skills.map(bullet)
      : [bullet("Add skills backed by evidence.")]),
    "",
    "## Current ask",
    compact(project.currentAsk) ||
      "Add the next action you want from a reviewer.",
    "",
  ].join("\n");
}

export interface CreateProjectMarkdownOptions {
  templateType?: ProjectTemplateType;
  title?: string;
  today?: string;
}

export function createProjectMarkdownTemplate(
  options: CreateProjectMarkdownOptions = {},
): string {
  const templateType = options.templateType ?? "generic";
  const template = projectTemplates[templateType];
  const today = options.today ?? localDateString();

  return [
    `# ${compact(options.title) || "Untitled project"}`,
    "",
    "## Summary",
    `Write one sentence explaining what this ${template.label.toLowerCase()} project does, who it is for, and what you did.`,
    "",
    "## What this shows",
    "- Add one concrete contribution this project demonstrates.",
    "- Add one outcome, decision, or learning signal.",
    "",
    "## Evidence",
    "- Add a demo, repo, screenshot, doc, metric, deck, notebook, or other inspectable source.",
    "",
    "## Milestones",
    `- ${today} - Created project record.`,
    "",
    "## Skills demonstrated",
    "- Skill: concrete action or source that shows it.",
    "",
    "## Current ask",
    "Add the next action you want from a reviewer.",
    "",
    ...template.sections.flatMap((section) => [
      `## ${section}`,
      "- Add the strongest specific detail.",
      "",
    ]),
    "<!-- buffalo",
    `template: ${templateType}`,
    template.category ? `category: ${template.category}` : "category:",
    "schema: project.md/v0.1",
    "prompts:",
    ...template.prompts.map((prompt) => `- ${prompt}`),
    "buffalo -->",
    "",
  ].join("\n");
}

export function appendMilestoneMarkdown(
  markdown: string,
  milestone: Omit<ProjectMilestone, "id">,
): string {
  const line = bullet(
    `${milestone.date} - ${milestone.title}${milestone.note ? `: ${milestone.note}` : ""}`,
  );

  return appendToSection(markdown, "Milestones", line);
}

export function appendEvidenceMarkdown(
  markdown: string,
  evidence: Pick<ProjectEvidence, "source" | "caption" | "milestoneId">,
): string {
  const caption = compact(evidence.caption);
  const milestone = compact(evidence.milestoneId);
  const suffix = [caption, milestone ? `milestone: ${milestone}` : ""]
    .filter(Boolean)
    .join(" - ");
  const line = bullet(`${evidence.source}${suffix ? ` - ${suffix}` : ""}`);

  return appendToSection(markdown, "Evidence", line);
}

function appendToSection(
  markdown: string,
  section: string,
  line: string,
): string {
  const heading = `## ${section}`;
  const lines = markdown.replace(/\s+$/u, "").split(/\r?\n/);
  const start = lines.findIndex(
    (candidate) => candidate.trim().toLowerCase() === heading.toLowerCase(),
  );

  if (start === -1) {
    return `${lines.join("\n")}\n\n${heading}\n${line}\n`;
  }

  const nextHeading = lines.findIndex(
    (candidate, index) => index > start && /^#{1,3}\s+/.test(candidate.trim()),
  );
  const insertAt = nextHeading === -1 ? lines.length : nextHeading;
  const existingPlaceholder = lines.findIndex(
    (candidate, index) =>
      index > start &&
      index < insertAt &&
      /add (a|one|the|skills|latest)/i.test(candidate),
  );

  if (existingPlaceholder !== -1) {
    lines.splice(existingPlaceholder, 1, line);
  } else {
    lines.splice(insertAt, 0, line);
  }

  return `${lines.join("\n")}\n`;
}
