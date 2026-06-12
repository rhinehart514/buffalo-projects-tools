/**
 * Buffalo Projects profile card — iframe-side script (MCP Apps, SEP-1865).
 *
 * Bundled by scripts/build-app.mjs into profile-card.html and served as the
 * ui://buffalo-projects/profile-card.html resource. Receives the
 * buffalo.get_velocity tool result from the host and renders a velocity
 * profile card. Every rendered field comes from the tool result; anything
 * missing renders as nothing (no placeholder copy, no invented data).
 */
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface VelocityBuilder {
  name?: string;
  handle?: string;
  headline?: string;
  profileUrl?: string;
  vouchCount?: number;
}

interface VelocityData {
  days?: number;
  totalEntries?: number;
  activeDays?: number;
  byDay?: Record<string, number>;
  latest?: Array<{ title?: unknown; dateKey?: unknown }>;
  builder?: VelocityBuilder;
}

const root = document.getElementById("root") as HTMLElement;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function asCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * GitHub-style weekly heatmap of the last `days` days, ending today, using
 * the brand-blue intensity scale. Levels are relative to the busiest day in
 * the window (1–4); zero-count days stay neutral.
 */
function renderHeatmap(byDay: Record<string, number>, days: number): HTMLElement {
  const heatmap = el("div", "heatmap");
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - (days - 1));
  // Align the first column to the start of its week (Sunday) so columns are
  // calendar weeks; leading cells before the window are simply not rendered.
  const gridStart = new Date(start);
  gridStart.setDate(start.getDate() - start.getDay());

  const max = Math.max(...Object.values(byDay), 1);
  let week: HTMLElement | null = null;
  for (
    let cursor = new Date(gridStart);
    cursor <= today;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    if (cursor.getDay() === 0 || week === null) {
      week = el("div", "heatmap-week");
      heatmap.appendChild(week);
    }
    if (cursor < start) {
      const spacer = el("span", "heatmap-day");
      spacer.style.visibility = "hidden";
      week.appendChild(spacer);
      continue;
    }
    const key = localDateKey(cursor);
    const count = asCount(byDay[key]) ?? 0;
    const cell = el("span", "heatmap-day");
    if (count > 0) {
      const level = Math.max(1, Math.min(4, Math.ceil((count / max) * 4)));
      cell.setAttribute("data-level", String(level));
      cell.title = `${key}: ${count} ${count === 1 ? "entry" : "entries"}`;
    } else {
      cell.title = key;
    }
    week.appendChild(cell);
  }
  return heatmap;
}

function render(data: VelocityData): void {
  root.replaceChildren();
  const card = el("article", "card");

  const builder = data.builder ?? {};
  const name = asText(builder.name);
  const handle = asText(builder.handle);
  const headline = asText(builder.headline);
  const profileUrl = asText(builder.profileUrl);
  const vouchCount = asCount(builder.vouchCount);

  // Identity — only what exists.
  if (name || handle || headline || profileUrl) {
    const head = el("div", "card-head");
    const identity = el("div", "identity");
    if (name) {
      identity.appendChild(el("h1", "name", name));
    }
    if (handle) {
      identity.appendChild(el("div", "handle", `@${handle}`));
    }
    if (headline) {
      identity.appendChild(el("p", "headline", headline));
    }
    head.appendChild(identity);
    if (profileUrl) {
      const open = el("button", "open-link", "View record ↗");
      open.type = "button";
      open.addEventListener("click", () => {
        void app.openLink({ url: profileUrl }).catch(() => {});
      });
      head.appendChild(open);
    }
    card.appendChild(head);
  }

  // Velocity — stats line plus heatmap, only when real entries exist.
  const totalEntries = asCount(data.totalEntries);
  const activeDays = asCount(data.activeDays);
  const days = asCount(data.days);
  const byDay = data.byDay ?? {};
  if (totalEntries !== undefined && totalEntries > 0) {
    const velocity = el("div", "velocity");
    const stats = el("div", "velocity-stats");
    stats.appendChild(
      el(
        "span",
        "active",
        `${totalEntries} ${totalEntries === 1 ? "entry" : "entries"}`,
      ),
    );
    const trail: string[] = [];
    if (activeDays !== undefined) {
      trail.push(`${activeDays} active ${activeDays === 1 ? "day" : "days"}`);
    }
    if (days !== undefined) {
      trail.push(`last ${days} days`);
    }
    if (trail.length) {
      stats.appendChild(document.createTextNode(` · ${trail.join(" · ")}`));
    }
    velocity.appendChild(stats);
    if (days !== undefined && Object.keys(byDay).length > 0) {
      velocity.appendChild(renderHeatmap(byDay, days));
    }
    card.appendChild(velocity);
  }

  // Latest entry + vouches — single meta rows, omitted when absent.
  const latest = Array.isArray(data.latest) ? data.latest[0] : undefined;
  const latestTitle = latest ? asText(latest.title) : undefined;
  const latestDate = latest ? asText(latest.dateKey) : undefined;
  const meta = el("div", "meta");
  if (latestTitle) {
    const row = el("div", "meta-row");
    row.appendChild(el("span", "meta-label", "Latest"));
    row.appendChild(el("span", "meta-value", latestTitle));
    if (latestDate) {
      row.appendChild(el("span", "meta-date", latestDate));
    }
    meta.appendChild(row);
  }
  if (vouchCount !== undefined && vouchCount > 0) {
    const row = el("div", "meta-row");
    row.appendChild(el("span", "meta-label", "Vouched"));
    row.appendChild(
      el(
        "span",
        "meta-value",
        `${vouchCount} ${vouchCount === 1 ? "vouch" : "vouches"} on record`,
      ),
    );
    meta.appendChild(row);
  }
  if (meta.childElementCount > 0) {
    card.appendChild(meta);
  }

  // Footer: product wordmark + the real public record URL when it exists.
  const foot = el("div", "card-foot");
  foot.appendChild(el("span", "wordmark", "Buffalo Projects"));
  if (profileUrl) {
    foot.appendChild(
      el("span", "record-url", profileUrl.replace(/^https?:\/\//, "")),
    );
  }
  card.appendChild(foot);

  root.appendChild(card);
}

function extractVelocity(result: CallToolResult): VelocityData | null {
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent as VelocityData;
  }
  // Fallback for hosts that only forward content blocks: the tool's second
  // text block is the full JSON payload.
  for (const block of [...(result.content ?? [])].reverse()) {
    if (block.type === "text") {
      try {
        const parsed: unknown = JSON.parse(block.text);
        if (parsed && typeof parsed === "object") {
          return parsed as VelocityData;
        }
      } catch {
        // Not JSON — keep looking.
      }
    }
  }
  return null;
}

function handleHostContextChanged(ctx: McpUiHostContext): void {
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
  if (ctx.styles?.css?.fonts) {
    applyHostFonts(ctx.styles.css.fonts);
  }
  if (ctx.displayMode) {
    document.body.setAttribute("data-display-mode", ctx.displayMode);
  }
}

const app = new App({ name: "Buffalo Projects profile card", version: "1.0.0" });

app.ontoolresult = (result) => {
  const data = extractVelocity(result as CallToolResult);
  if (data) {
    render(data);
  }
};

app.onhostcontextchanged = handleHostContextChanged;
app.onerror = () => {};

void app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) {
    handleHostContextChanged(ctx);
  }
});

// Verification hook: lets a local harness render the card with a known
// payload (screenshot/smoke checks) without speaking the host protocol.
declare global {
  interface Window {
    __buffaloRenderProfileCard?: (data: VelocityData) => void;
  }
}
window.__buffaloRenderProfileCard = render;
