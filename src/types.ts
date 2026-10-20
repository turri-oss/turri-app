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
  /** Built, and its conformance tests written and passing - as the spec has it now. */
  conformed: boolean;
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
  /** A project just started: what turri said of the config it wrote for it - its models, and how to sign in. */
  setup?: string;
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
  /** The spec change a pulse renders, as a diff of the .plain files. */
  diff?: string;
  /** Where the diff's lines are in the .plain files: by a line's place in the diff, its file and its line there (from 1). */
  diffWhere?: Record<number, { file: string; line: number; section?: string }>;
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
  /** What failed in it that the work went on past - a healer, the model provider - each once: a mark on its card. */
  failures: Failure[];
}

/** A failure of a pulse's, from the ledger: `mark` is what its card says, `text` the whole of it. */
export interface Failure {
  mark: string;
  text: string;
}

/** A pulse of an earlier session, as the ledger has it: read only, nothing of it live. */
export interface PastPulse {
  id: string;
  run: string;
  kind: string;
  summary: string;
  module: string | null;
  pulse: number | null;
  title: string | null;
  /** How it ended - or that it never did, its run stopped while it ran (unended) or before it started (unstarted). */
  status: "succeeded" | "failed" | "stopped" | "unended" | "unstarted";
  landed: boolean | null;
  stoppedBy: "person" | "turri" | null;
  ms: number | null;
  usage: Usage | null;
  error: string | null;
  failures: Failure[];
}

/** A run of turri's in the project - a session of the app's, a chat in a terminal, a headless regenerate - and its pulses. */
export interface PastRun {
  run: string;
  mode: string | null;
  started: string | null;
  version: string | null;
  pulses: PastPulse[];
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

export type View = "spec" | "work" | "preview";
/** What the preview tries the app in: a browser pane, or a terminal. */
export type Pane = "browser" | "terminal";
