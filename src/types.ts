import type { TurriApi } from "../electron/preload.ts";

declare global {
  interface Window {
    turri: TurriApi;
  }
}

export interface FunctionalSpec {
  frid: string;
  text: string;
  built: boolean;
}

export interface Spec {
  file: string;
  rel: string;
  ok: boolean;
  module: string;
  description?: string;
  requires: string[];
  error?: string;
  built?: boolean;
  drifted?: boolean;
  conformanceTested?: number;
  functionalSpecs: FunctionalSpec[];
}

export interface Project {
  dir: string;
  name: string;
  turriHome: string;
  hasConfig: boolean;
  stacks: string[];
  settings: Record<string, string | number | boolean | null>;
  specs: Spec[];
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface Job {
  id: string;
  kind: string;
  summary: string;
  module?: string;
  pulse?: number;
  title?: string;
  diff?: string;
  model?: string;
  status: "queued" | "running" | "succeeded" | "failed" | "stopped";
  sequence: number;
  queuedAt: number;
  startedAt: number;
  finishedAt?: number;
  planning?: { since: number };
  waitingOn: string[];
  stage?: string;
  building?: { label: string; text: string; since?: number };
  activity: string[];
  now?: { label: string; since: number };
  usage: Usage;
  agents: Array<{ label: string; model?: string; turns: number; compactions: number; usage: Usage }>;
  transcriptLength: number;
  report?: string;
  announce?: string;
  error?: string;
  diagnosis?: string;
  environment?: string;
  note?: string;
  specGaps: Array<{ question: string; assumption: string }>;
}

export interface ModuleStatus {
  module: string;
  plainFile: string;
  running?: { jobId: string; title: string };
  planned: Array<{ title: string; track: "code" | "conformance"; planning?: true; afterCode?: true }>;
  planNotes?: string[];
  why?: string;
  stack?: string;
}

export interface Status {
  modules: ModuleStatus[];
  jobs: Job[];
  planned: Job[];
}

export interface TranscriptEntry {
  kind: "stage" | "spec" | "diff" | "prompt" | "text" | "thinking" | "tool" | "result";
  text: string;
  error?: boolean;
  full?: string;
  agent?: { label: string; model?: string };
}

export type View = "spec" | "work" | "code" | "history";
