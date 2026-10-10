import { existsSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { tailLines, formatLocal } from "./bin/format.mjs";
import { runsFile } from "./bin/paths.mjs";

const RECENT_RUN_LIMIT = 20;
const HISTORY_SCAN_LIMIT = 1000;

type RecentRun = {
  runId: string;
  jobId: string;
  startedAt: string;
  exitCode: number;
  error?: string | null;
  transcriptPath: string;
  finalTextPreview?: string | null;
};

function isViewableRun(value: unknown): value is RecentRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Partial<RecentRun>;
  return typeof run.runId === "string"
    && typeof run.jobId === "string"
    && typeof run.startedAt === "string"
    && typeof run.transcriptPath === "string"
    && existsSync(run.transcriptPath);
}

function startedAtMillis(run: RecentRun): number {
  const value = new Date(run.startedAt).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function loadRecentRuns(limit = RECENT_RUN_LIMIT): RecentRun[] {
  if (!existsSync(runsFile())) return [];
  const runs: RecentRun[] = [];
  for (const line of tailLines(runsFile(), HISTORY_SCAN_LIMIT)) {
    try {
      const run = JSON.parse(line);
      if (isViewableRun(run)) runs.push(run);
    } catch { /* skip malformed audit lines */ }
  }
  return runs.sort((a, b) => startedAtMillis(b) - startedAtMillis(a)).slice(0, limit);
}

function runDescription(run: RecentRun): string {
  const preview = run.finalTextPreview || run.error || "No final response";
  return `${preview.replace(/\s+/g, " ")} · run ${run.runId.slice(0, 8)}`;
}

function buildItems(runs: RecentRun[]): SelectItem[] {
  return runs.map((run, index) => ({
    value: String(index),
    label: `${run.exitCode === 0 ? "✓" : "✗"} ${formatLocal(run.startedAt)}  ${run.jobId}`,
    description: runDescription(run),
  }));
}

function createPicker(tui: any, theme: any, done: (value: string | null) => void, items: SelectItem[]) {
  const container = new Container();
  container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
  container.addChild(new Text(theme.fg("accent", theme.bold("Recent tick runs")), 1, 0));
  const list = new SelectList(items, Math.min(items.length, 12), {
    selectedPrefix: (text) => theme.fg("accent", text),
    selectedText: (text) => theme.fg("accent", text),
    description: (text) => theme.fg("muted", text),
    scrollInfo: (text) => theme.fg("dim", text),
    noMatch: (text) => theme.fg("warning", text),
  });
  list.onSelect = (item) => done(item.value);
  list.onCancel = () => done(null);
  container.addChild(list);
  container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter open • esc cancel"), 1, 0));
  container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
  return {
    render: (width: number) => container.render(width),
    invalidate: () => container.invalidate(),
    handleInput: (data: string) => { list.handleInput(data); tui.requestRender(); },
  };
}

export async function pickRecentRun(ctx: ExtensionContext): Promise<RecentRun | null> {
  const runs = loadRecentRuns();
  if (runs.length === 0) {
    ctx.ui.notify("(no viewable tick runs yet)", "info");
    return null;
  }
  const selected = await ctx.ui.custom<string | null>((tui, theme, _keys, done) =>
    createPicker(tui, theme, done, buildItems(runs)));
  if (selected == null) return null;
  return runs[Number(selected)] ?? null;
}
