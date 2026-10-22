import { useEffect, useState } from "react";
import type { Job } from "./types.ts";
import { Icon, PlainMark, PlainName } from "./ui.tsx";

type Token = { text: string; role: string | null };
type Line = { kind: "context" | "add" | "del" | "gap"; text: string; line?: number };
type File = { file: string; lines: Line[] };

/**
 * A pulse's spec change, file by file, as its diff says it: the lines it renders, the sections around them, and what it
 * takes out - each where it is in the file, when turri placed it there.
 */
function filesOf(diff: string, where: Job["diffWhere"]): File[] {
  const files: File[] = [];
  let current: File | undefined;
  let header = false;
  const raws = diff.replace(/\n$/, "").split("\n");
  raws.forEach((raw, index) => {
    if (raw.startsWith("diff --git ")) {
      current = { file: raw.split(" b/").at(-1) ?? "", lines: [] };
      files.push(current);
      header = true;
      return;
    }
    // A file's header, up to its first hunk: not the spec's. A spec line taken out that starts with --- is a hunk's.
    if (header && !raw.startsWith("@@")) return;
    if (raw.startsWith("@@")) {
      header = false;
      if (current !== undefined && current.lines.length > 0) current.lines.push({ kind: "gap", text: "" });
      return;
    }
    if (current === undefined) {
      current = { file: where?.[index]?.file ?? "", lines: [] };
      files.push(current);
    }
    const kind = raw.startsWith("+") ? "add" : raw.startsWith("-") ? "del" : "context";
    current.lines.push({ kind, text: raw.slice(1), ...(where?.[index] !== undefined ? { line: where[index]!.line } : {}) });
  });
  return files;
}

/**
 * A pulse's lines - each its number when the pulse ran and its text - where they are in the ***plain now, from 1: an
 * edit since, or another pulse's, moves them. Each run of them - lines that follow one another, a blank between - moves
 * as one, by the offset that finds most of its lines' text there, the smallest of those; a run whose text is not there
 * at all keeps its numbers.
 */
export function relocate(all: string[], lines: number[], texts: string[]): number[] {
  const runs: number[][] = [];
  lines.forEach((line, at) => (at > 0 && line > lines[at - 1]! && line - lines[at - 1]! <= 2 ? runs.at(-1)!.push(at) : runs.push([at])));
  return runs.flatMap((run) => {
    const offsets = new Set<number>();
    for (const at of run) all.forEach((text, index) => text === texts[at] && offsets.add(index - (lines[at]! - 1)));
    let best = { offset: 0, found: 0 };
    for (const offset of offsets) {
      const found = run.filter((at) => all[lines[at]! - 1 + offset] === texts[at]).length;
      if (found > best.found || (found === best.found && Math.abs(offset) < Math.abs(best.offset))) best = { offset, found };
    }
    return run.map((at) => lines[at]! + best.offset);
  });
}

/** The functional spec a conformance run builds, as its label says it: `frontend functionality 2 of 5`. */
function buildingOf(job: Job): { frid: string; text: string } | null {
  const named = /functionality (\S+) of/.exec(job.building?.label ?? "");
  return named && job.building?.text ? { frid: named[1]!, text: job.building.text } : null;
}

/** Whether a pulse regenerates the spec as it is - a functional spec regenerated again: its spec change changes nothing. */
export function unchangedSpec(job: Job): boolean {
  const lines = job.diff?.split("\n") ?? [];
  return job.kind !== "conformance" && lines.length > 0 && !lines.some((line) => (line.startsWith("+") && !line.startsWith("+++")) || (line.startsWith("-") && !line.startsWith("---")));
}

/**
 * turri's own words for its work - a stage, an activity line, an agent's name, a note - as the window says them. turri
 * speaks of a "spec change", but a pulse runs with no change too - a functional spec regenerated again, conformance
 * tests written for what is built - so the window never says it: a pulse's stage is what it does, regenerating or
 * conformance testing, and elsewhere the words go, or say what happened instead.
 */
export function turriSays(text: string): string {
  return text
    .replace(/\bthe spec changed inside what it regenerates\b/gi, "the ***plain was edited while it ran")
    .replace(/\b(once|whenever|until|when) the spec changes\b/gi, "$1 the ***plain is edited")
    .replace(/\ba spec change does not start it\b/gi, "editing the ***plain does not start it")
    .replace(/\s+(for )?(a |the )?spec change\b/gi, "")
    .replace(/\bspec change\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** A pulse's stage, as the person is to read it: one that speaks of a spec change says what the pulse does instead. */
export function stageOf(job: Job): string | undefined {
  if (job.stage === undefined) return undefined;
  if (/spec change/i.test(job.stage) && !/spec changed inside/i.test(job.stage)) return job.kind === "conformance" ? "turri is conformance testing" : "turri is regenerating";
  return turriSays(job.stage);
}

/** Whether a pulse has a part of the spec to show. */
export function hasSpecPart(job: Job): boolean {
  return Boolean(job.diff?.trim()) || buildingOf(job) !== null;
}

/**
 * The ***plain a pulse works on: its spec change, coloured by turri's grammar - the lines it renders lit, as the spec
 * lights them while it runs - or, for a conformance run, the functional spec it builds. Each file's part opens in the
 * spec, its lines lit there.
 */
export function PulseSpec({ job, onShowInSpec }: { job: Job; onShowInSpec: (file: string, lines: Array<{ line: number; text: string }>) => void }) {
  const files = job.diff?.trim() ? filesOf(job.diff, job.diffWhere) : [];
  const building = buildingOf(job);
  if (files.length === 0 && building === null) return <p className="muted pad">this pulse works on no part of the <PlainName /> it says: read its conversation.</p>;
  return (
    <div className="pulse-spec">
      {building && (
        <section>
          <div className="pulse-spec-head">
            <span>
              <Icon name="test" size={13} /> functional spec {building.frid}
            </span>
          </div>
          <Coloured lines={building.text.split("\n").map((text) => ({ kind: "add" as const, text }))} />
        </section>
      )}
      {files.map((shown) => {
        // A spec change that changes nothing in the file - a functional spec regenerated again - carries the functional
        // spec as it is, unchanged: that is what the pulse builds, again.
        const again = !shown.lines.some((line) => line.kind === "add" || line.kind === "del");
        const file = again ? { ...shown, lines: shown.lines.map((line) => (line.kind === "context" && !/^\*\*\*.*\*\*\*$/.test(line.text.trim()) && line.text.trim() !== "" ? { ...line, kind: "add" as const } : line)) } : shown;
        const lines = file.lines.flatMap((line) => (line.kind === "add" && line.line !== undefined ? [{ line: line.line, text: line.text }] : []));
        const added = file.lines.filter((line) => line.kind === "add").length;
        const taken = file.lines.filter((line) => line.kind === "del").length;
        return (
          <section key={file.file}>
            <div className="pulse-spec-head">
              <span>
                <PlainMark size={14} /> {file.file}
                <span className="muted">
                  {" "}
                  · {added} line{added === 1 ? "" : "s"} to render{again ? " again, unchanged" : ""}{taken > 0 ? `, ${taken} taken out` : ""}
                </span>
              </span>
              {lines.length > 0 && (
                <button className="link" onClick={() => onShowInSpec(file.file, lines)}>
                  open in intent
                </button>
              )}
            </div>
            <Coloured lines={file.lines} />
          </section>
        );
      })}
    </div>
  );
}

/** Lines of ***plain, coloured as the spec is: each with its line in the file, if it has one, and what the pulse does with it. */
function Coloured({ lines }: { lines: Line[] }) {
  const [tokens, setTokens] = useState<Token[][] | null>(null);
  const text = lines.map((line) => line.text).join("\n");
  useEffect(() => {
    let alive = true;
    void window.turri.call<Token[][]>("highlightSpec", { text }).then((next) => alive && setTokens(next));
    return () => void (alive = false);
  }, [text]);
  // The lines the diff leaves out between two it has: the blank line between two items - turri's diff is of the ***plain's
  // items, not its text - a blank row, and more a gap.
  const skipped = (index: number) => {
    const before = lines.slice(0, index).findLast((line) => line.kind !== "gap");
    const line = lines[index]!;
    return before?.line !== undefined && line.line !== undefined && lines[index - 1]?.kind !== "gap" ? line.line - before.line - 1 : 0;
  };
  return (
    <div className="pulse-spec-lines">
      {lines.map((line, index) => [
        skipped(index) === 1 ? (
          <div key={`${index}-blank`} className="context">
            <span className="pulse-spec-number">{line.line! - 1}</span>
            <span className="pulse-spec-text">{"\u200b"}</span>
          </div>
        ) : skipped(index) > 1 ? (
          <div key={`${index}-gap`} className="gap">
            ⋯
          </div>
        ) : null,
        line.kind === "gap" ? (
          <div key={index} className="gap">
            ⋯
          </div>
        ) : (
          <div key={index} className={line.kind}>
            <span className="pulse-spec-number">{line.line ?? ""}</span>
            <span className="pulse-spec-text">
              {line.text === ""
                ? "​"
                : tokens?.[index] && tokens[index]!.map((token) => token.text).join("") === line.text
                  ? tokens[index]!.map((token, at) => (token.role ? <span key={at} className={`plain-${token.role}`}>{token.text}</span> : token.text))
                  : line.text}
            </span>
          </div>
        ),
      ])}
    </div>
  );
}
