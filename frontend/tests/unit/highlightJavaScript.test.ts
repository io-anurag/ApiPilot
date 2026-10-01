import { describe, expect, it } from "vitest";
import { highlightJavaScript } from "../../src/components/userScript/highlightJavaScript";

/** AP-034 FR-010, research R19 (tasks T058). */
describe("highlightJavaScript", () => {
  it("recognises comments, strings, templates, numbers, keywords, identifiers and punctuation", () => {
    const tokens = highlightJavaScript('// note\nconst a = "x\\"y" + `t${1}` + 42; /* block */');
    const kinds = tokens.filter((token) => token.kind !== "whitespace").map((token) => `${token.kind}:${token.text}`);
    expect(kinds).toEqual([
      "comment:// note",
      "keyword:const",
      "identifier:a",
      "punctuation:=",
      'string:"x\\"y"',
      "punctuation:+",
      "template:`t${1}`",
      "punctuation:+",
      "number:42",
      "punctuation:;",
      "comment:/* block */",
    ]);
  });

  it("gives back the input exactly when its tokens are joined", () => {
    for (const text of ["", "a\r\nb", 'import http from "k6/http";\n\nexport default function () {\n  http.get(`${__ENV.BASE_URL}/`);\n}\n', "'unterminated\nnext", "/* open comment", "x / y / z"]) {
      expect(highlightJavaScript(text).map((token) => token.text).join("")).toBe(text);
    }
  });
});
