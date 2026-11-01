/**
 * Makes arbitrary text safe to embed in a CodeMirror snippet template:
 * `${`/`#{` must not start fields, and `\{` / `\}` must survive the
 * template's own unescaping.
 */
export function escapeSnippetText(text: string): string {
  return text.replace(/\\(?=[{}])/g, '\\\\').replace(/([#$])\{/g, '$1\\{');
}

/**
 * Adds a final tab stop after the snippet (VS Code's `$0`) so Tab on the last
 * field leaves the braces instead of indenting the line. An unnamed empty
 * field is used: CodeMirror orders `${0}` before unnumbered fields, while
 * unnamed fields keep document order. Templates without fields are unchanged.
 */
export function withExit(template: string): string {
  if (!/[#$]\{/.test(template) || /[#$]\{\}$/.test(template)) return template;
  return `${template}\${}`;
}
