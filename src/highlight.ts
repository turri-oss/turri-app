// A file of the project that is code - a resource a ***plain links, a test script, its config - coloured as the
// ***plain is: highlight.js's reading of it, by its extension, put in the ***plain's roles, so it takes turri's palette
// and is drawn as the editor draws a .plain, line by line. What it does not know stays as it is: nothing is guessed.
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

type Token = { text: string; role: string | null };

const LANGUAGES = { bash, css, diff, dockerfile, go, ini, java, javascript, json, makefile, markdown, python, rust, sql, typescript, xml, yaml };
for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language);

/** Each language by the extensions its files have - or, for a few, by the file's whole name. */
const BY_EXTENSION: Record<string, keyof typeof LANGUAGES> = {
  yaml: "yaml", yml: "yaml",
  json: "json", jsonc: "json",
  py: "python",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescript",
  sh: "bash", bash: "bash", zsh: "bash",
  md: "markdown",
  html: "xml", xml: "xml", svg: "xml",
  css: "css",
  sql: "sql",
  toml: "ini", ini: "ini", cfg: "ini", env: "ini",
  go: "go",
  rs: "rust",
  java: "java",
  diff: "diff", patch: "diff",
};
const BY_NAME: Record<string, keyof typeof LANGUAGES> = { Dockerfile: "dockerfile", Makefile: "makefile", ".env": "ini" };

/** The language a file is in, by its name - or null for one it does not know. */
export function languageOf(file: string): string | null {
  const name = file.split(/[\\/]/).pop() ?? "";
  if (name in BY_NAME) return BY_NAME[name]!;
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return BY_EXTENSION[extension] ?? null;
}

/** highlight.js's scopes in the ***plain's roles: what names a thing as its keys do, what is said as its literals. */
const ROLES: Record<string, string> = {
  attr: "keyword", attribute: "keyword", property: "keyword", keyword: "keyword", name: "keyword", tag: "keyword",
  "selector-tag": "keyword", "selector-id": "keyword", "selector-class": "keyword",
  string: "literal", regexp: "literal", char: "literal", addition: "literal",
  number: "concept", literal: "concept", symbol: "concept", variable: "concept", "template-variable": "concept", deletion: "concept",
  built_in: "module", type: "module", title: "module", function: "module", class: "module",
  comment: "comment", quote: "comment", doc: "comment",
  meta: "meta", "meta-keyword": "meta",
  bullet: "bullet",
  section: "section",
  link: "link",
};

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'" };
const unescape = (html: string) => html.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (entity) => ENTITIES[entity]!);

/**
 * A file's text coloured, line by line, as the editor draws a .plain - each token's role its innermost scope's that has
 * one - or null for a language it does not know. Each line's tokens spell the line exactly.
 */
export function highlightCode(file: string, text: string): Token[][] | null {
  const language = languageOf(file);
  if (language === null) return null;
  const html = hljs.highlight(text, { language, ignoreIllegals: true }).value;
  const lines: Token[][] = [[]];
  // The scopes open where we are: a span's class `hljs-title class_` is the scope `title`.
  const open: Array<string | null> = [];
  const role = () => [...open].reverse().find((scope) => scope !== null && scope in ROLES) ?? null;
  for (const part of html.split(/(<span class="[^"]*">|<\/span>)/)) {
    if (part.startsWith("<span")) open.push(/class="hljs-([^" ]+)/.exec(part)?.[1] ?? null);
    else if (part === "</span>") open.pop();
    else if (part !== "") {
      const scope = role();
      unescape(part)
        .split("\n")
        .forEach((piece, at) => {
          if (at > 0) lines.push([]);
          if (piece !== "") lines.at(-1)!.push({ text: piece, role: scope === null ? null : ROLES[scope]! });
        });
    }
  }
  return lines;
}
