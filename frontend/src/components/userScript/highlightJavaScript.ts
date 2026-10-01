/**
 * A small JavaScript tokenizer for the script editor's highlighting (AP-034 FR-010, research R19).
 * It only splits text into coloured runs and never evaluates anything. It is approximate on purpose
 * (a `/` is never read as a regular expression): the authoritative reading of a script is the
 * backend's check. Joining every token's text gives back the input exactly.
 */
export type TokenKind = "comment" | "string" | "template" | "number" | "keyword" | "identifier" | "punctuation" | "whitespace";

export interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS: ReadonlySet<string> = new Set([
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "of",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "yield",
]);

function endOfQuoted(text: string, start: number, quote: string, stopAtNewline: boolean): number {
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote) return index + 1;
    if (stopAtNewline && char === "\n") return index;
    index += 1;
  }
  return text.length;
}

export function highlightJavaScript(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  const push = (kind: TokenKind, end: number) => {
    tokens.push({ kind, text: text.slice(index, end) });
    index = end;
  };
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "/" && next === "/") {
      const newline = text.indexOf("\n", index);
      push("comment", newline === -1 ? text.length : newline);
    } else if (char === "/" && next === "*") {
      const close = text.indexOf("*/", index + 2);
      push("comment", close === -1 ? text.length : close + 2);
    } else if (char === '"' || char === "'") {
      push("string", endOfQuoted(text, index, char, true));
    } else if (char === "`") {
      push("template", endOfQuoted(text, index, "`", false));
    } else if (/\s/.test(char)) {
      const match = /^\s+/.exec(text.slice(index, index + 4096));
      push("whitespace", index + (match ? match[0].length : 1));
    } else if (/\d/.test(char)) {
      const match = /^\d[\w.]*/.exec(text.slice(index, index + 256));
      push("number", index + (match ? match[0].length : 1));
    } else if (/[A-Za-z_$]/.test(char)) {
      const match = /^[\w$]+/.exec(text.slice(index, index + 512));
      const word = match ? match[0] : char;
      push(KEYWORDS.has(word) ? "keyword" : "identifier", index + word.length);
    } else {
      push("punctuation", index + 1);
    }
  }
  return tokens;
}
