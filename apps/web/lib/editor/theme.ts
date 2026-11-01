import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/**
 * Editor chrome and syntax colours come from CSS custom properties
 * (packages/ui tokens), so light/dark switches without rebuilding the editor.
 */
export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--lc-text)',
    backgroundColor: 'var(--lc-surface)',
    fontSize: '14px',
  },
  '.cm-scroller': { fontFamily: 'var(--lc-font-mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--lc-accent)', padding: '8px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--lc-accent)', borderLeftWidth: '2px' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--lc-syn-selection) !important',
  },
  '.cm-activeLine': { backgroundColor: 'var(--lc-syn-active-line)' },
  '.cm-gutters': {
    backgroundColor: 'var(--lc-surface)',
    color: 'var(--lc-text-subtle)',
    borderRight: '1px solid var(--lc-border)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--lc-syn-active-line)', color: 'var(--lc-text)' },
  '.cm-matchingBracket': {
    backgroundColor: 'var(--lc-syn-bracket)',
    outline: '1px solid var(--lc-accent)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--lc-warning-soft)',
    outline: '1px solid var(--lc-warning)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--lc-syn-bracket)' },
  '.cm-panels': { backgroundColor: 'var(--lc-surface-raised)', color: 'var(--lc-text)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--lc-border)' },
  '.cm-panel input, .cm-panel button': { fontFamily: 'var(--lc-font-sans)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--lc-surface-raised)',
    color: 'var(--lc-text)',
    border: '1px solid var(--lc-border)',
    borderRadius: 'var(--lc-radius-md)',
    boxShadow: 'var(--lc-shadow-md)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--lc-accent-soft)',
    color: 'var(--lc-text)',
  },
  '.cm-completionDetail': {
    color: 'var(--lc-text-subtle)',
    fontStyle: 'normal',
    marginLeft: '8px',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--lc-surface-sunken)',
    border: 'none',
    color: 'var(--lc-text-muted)',
  },
});

export const highlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.tagName], color: 'var(--lc-syn-command)' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: 'var(--lc-syn-atom)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--lc-syn-string)' },
  { tag: [t.number], color: 'var(--lc-syn-number)' },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: 'var(--lc-syn-comment)',
    fontStyle: 'italic',
  },
  { tag: [t.bracket, t.brace, t.squareBracket, t.paren], color: 'var(--lc-syn-bracket-text)' },
  { tag: [t.propertyName, t.labelName, t.attributeName], color: 'var(--lc-syn-property)' },
  { tag: [t.operator], color: 'var(--lc-text-muted)' },
  { tag: [t.heading, t.strong], fontWeight: '600' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.invalid], color: 'var(--lc-danger)' },
]);

export const syntaxTheme = syntaxHighlighting(highlightStyle);

/**
 * Collaborators' cursors (y-codemirror.next): a thin caret with a name flag
 * that stays readable instead of appearing only on hover.
 */
export const collabCursorTheme = EditorView.theme({
  '.cm-ySelectionCaret': { position: 'relative', margin: '0 -1px', borderLeft: '2px solid' },
  '.cm-ySelectionCaretDot': { display: 'none' },
  '.cm-ySelectionInfo': {
    top: '-1.4em',
    left: '-2px',
    padding: '1px 5px',
    borderRadius: '3px 3px 3px 0',
    color: '#fff',
    fontFamily: 'var(--lc-font-sans)',
    fontSize: '10.5px',
    fontWeight: '600',
    lineHeight: '1.3',
    opacity: '0.92',
    pointerEvents: 'none',
    userSelect: 'none',
  },
  '.cm-ySelectionCaret:hover > .cm-ySelectionInfo': { opacity: '0.3' },
});
