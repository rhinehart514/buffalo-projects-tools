import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Project } from "@buffalo/schema";

export interface ProjectPreviewRenderInput {
  project: Project;
  markdown: string;
  generatedAt?: Date;
}

const h = createElement;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function humanize(value: string): string {
  return value.replaceAll("-", " ");
}

function TextList({
  items,
  emptyLabel,
}: {
  items: string[] | undefined;
  emptyLabel: string;
}) {
  const values = items?.filter(Boolean) ?? [];

  if (!values.length) {
    return h("p", { className: "muted" }, emptyLabel);
  }

  return h(
    "ul",
    null,
    values.map((item) => h("li", { key: item }, item)),
  );
}

function EvidenceList({ project }: { project: Project }) {
  const structured = project.evidence?.map((item) => ({
    source: item.source,
    caption: item.caption,
  }));
  const fromBindings = [
    project.githubRepoUrl
      ? { source: project.githubRepoUrl, caption: "Repository" }
      : null,
    project.projectUrl ? { source: project.projectUrl, caption: "Project URL" } : null,
  ].filter((item): item is { source: string; caption: string } => Boolean(item));
  const values = [...(structured ?? []), ...fromBindings];

  if (!values.length) {
    return h("p", { className: "muted" }, "No evidence attached yet.");
  }

  return h(
    "ul",
    null,
    values.map((item) => {
      const label = item.caption || item.source;
      const href = /^https?:\/\//i.test(item.source) ? item.source : undefined;

      return h(
        "li",
        { key: `${item.source}:${label}` },
        href ? h("a", { href }, label) : label,
      );
    }),
  );
}

function MilestoneList({ project }: { project: Project }) {
  if (!project.milestones?.length) {
    return h("p", { className: "muted" }, "No milestones logged yet.");
  }

  return h(
    "ol",
    null,
    project.milestones.map((milestone) =>
      h(
        "li",
        { key: `${milestone.date}:${milestone.title}` },
        h("strong", null, milestone.title),
        h("span", null, milestone.date),
        milestone.note ? h("p", null, milestone.note) : null,
      ),
    ),
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return h("section", null, h("h2", null, title), children);
}

function Panel({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return h("div", { className: "panel" }, h("h2", null, title), children);
}

export function ProjectPreview({
  project,
  markdown,
  generatedAt = new Date(),
}: ProjectPreviewRenderInput) {
  const skills = project.primarySkills?.filter(Boolean) ?? [];
  const stage = project.stage ? humanize(project.stage) : "draft";
  const template = project.templateType
    ? humanize(project.templateType)
    : project.category ?? "generic";
  const metric =
    project.metricLabel && project.metricValue
      ? h(
          "div",
          { className: "metric" },
          h("span", null, project.metricLabel),
          h("strong", null, project.metricValue),
        )
      : null;

  return h(
    "main",
    null,
    h(
      "header",
      null,
      h(
        "div",
        { className: "eyebrow" },
        h("span", { className: "pill" }, template),
        h("span", { className: "pill" }, stage),
        h("span", { className: "pill" }, project.privacy),
      ),
      h("h1", null, project.title),
      h("p", { className: "summary" }, project.description || "No summary written yet."),
    ),
    h(
      "div",
      { className: "grid" },
      h(
        "div",
        null,
        h(
          Section,
          { title: "What This Shows" },
          h(TextList, {
            items: project.proofStatements,
            emptyLabel: "Add concrete outcomes or proof statements.",
          }),
        ),
        h(Section, { title: "Evidence" }, h(EvidenceList, { project })),
        h(Section, { title: "Milestones" }, h(MilestoneList, { project })),
        h(Section, { title: "Project.md" }, h("pre", null, markdown)),
      ),
      h(
        "aside",
        null,
        h(
          Panel,
          { title: "Skills" },
          skills.length
            ? h(
                "ul",
                { className: "skills" },
                skills.map((skill) => h("li", { key: skill }, skill)),
              )
            : h("p", { className: "muted" }, "No skills named yet."),
        ),
        project.currentAsk
          ? h(Panel, { title: "Current Ask" }, h("p", null, project.currentAsk))
          : null,
        metric ? h(Panel, { title: "Metric" }, metric) : null,
      ),
    ),
    h(
      "footer",
      null,
      `Generated locally by Buffalo preview on ${generatedAt.toISOString()}.`,
    ),
  );
}

const previewCss = `
    :root {
      color-scheme: light;
      --ink: #202124;
      --muted: #62666d;
      --line: #d9dde3;
      --paper: #ffffff;
      --wash: #f5f7fa;
      --accent: #0f766e;
      --accent-soft: #d7f2ed;
      --gold: #9a6a12;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--wash);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
    }
    main {
      max-width: 1080px;
      margin: 0 auto;
      padding: 40px 24px 56px;
    }
    header {
      display: grid;
      gap: 18px;
      padding: 32px 0 28px;
      border-bottom: 1px solid var(--line);
    }
    .eyebrow {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      color: var(--muted);
      font-size: 0.85rem;
      text-transform: capitalize;
    }
    .pill {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 4px 10px;
      background: var(--paper);
    }
    h1 {
      margin: 0;
      font-size: clamp(2.25rem, 6vw, 4.8rem);
      line-height: 0.96;
      letter-spacing: 0;
      max-width: 840px;
    }
    .summary {
      margin: 0;
      max-width: 760px;
      color: #343840;
      font-size: 1.1rem;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
      gap: 28px;
      align-items: start;
      padding-top: 28px;
    }
    section {
      padding: 22px 0;
      border-bottom: 1px solid var(--line);
    }
    h2 {
      margin: 0 0 12px;
      font-size: 0.95rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    ul, ol { margin: 0; padding-left: 1.2rem; }
    li + li { margin-top: 8px; }
    a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 3px; }
    .panel {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 20px;
    }
    .panel + .panel { margin-top: 16px; }
    .muted { color: var(--muted); }
    .skills {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 0;
      list-style: none;
    }
    .skills li {
      margin: 0;
      background: var(--accent-soft);
      color: #064e46;
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 0.9rem;
    }
    .metric {
      display: grid;
      gap: 4px;
      background: #fff7df;
      border: 1px solid #efd186;
      border-radius: 8px;
      padding: 14px;
      color: var(--gold);
    }
    .metric strong { color: #5d3d03; font-size: 1.4rem; }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: #111827;
      color: #f8fafc;
      border-radius: 8px;
      padding: 18px;
      font-size: 0.88rem;
      line-height: 1.55;
    }
    footer {
      color: var(--muted);
      font-size: 0.82rem;
      padding-top: 20px;
    }
    @media (max-width: 780px) {
      main { padding: 24px 18px 40px; }
      .grid { grid-template-columns: 1fr; }
      header { padding-top: 20px; }
    }
`;

export function renderProjectPreviewHtml(input: ProjectPreviewRenderInput): string {
  const body = renderToStaticMarkup(h(ProjectPreview, input));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.project.title)} - Buffalo Preview</title>
  <style>${previewCss}</style>
</head>
<body>${body}</body>
</html>`;
}
