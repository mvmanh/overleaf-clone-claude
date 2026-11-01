import { type EditorState, StateField } from '@codemirror/state';
import { showTooltip, type Tooltip } from '@codemirror/view';
import { MATH_ENVIRONMENTS, mathContextAt } from '../../latex/math-context';
import type { ProjectIndex } from '../../latex/project-index';
import { renderMathInto } from './katex';

export interface MathRegion {
  from: number;
  to: number;
  tex: string;
  display: boolean;
}

/** The math block containing `pos`, from its opening to its closing delimiter. */
export function mathRegionAt(doc: string, pos: number): MathRegion | null {
  const ctx = mathContextAt(doc, pos);
  if (!ctx.inMath || ctx.start === undefined) return null;
  const start = ctx.start;
  let end = -1;
  if (ctx.kind === 'environment' && ctx.environment) {
    end = doc.indexOf(`\\end{${ctx.environment}}`, pos);
  } else {
    const opener = doc.slice(Math.max(0, start - 2), start);
    const closer = opener.endsWith('\\(')
      ? '\\)'
      : opener.endsWith('\\[')
        ? '\\]'
        : opener === '$$'
          ? '$$'
          : '$';
    for (let i = pos; i < doc.length && i < pos + 20000; i++) {
      if (doc[i] === '\\' && closer !== '\\)' && closer !== '\\]') {
        i++;
        continue;
      }
      if (doc.startsWith(closer, i) && doc[i - 1] !== '\\') {
        end = i;
        break;
      }
      if (closer === '$' && doc[i] === '\n' && doc[i + 1] === '\n') break;
    }
  }
  if (end < 0) end = Math.min(doc.length, pos + 2000);
  let tex = doc.slice(start, end);
  if (!tex.trim()) return null;
  const env = ctx.environment;
  if (env && MATH_ENVIRONMENTS.has(env) && !/^(equation|math|displaymath)\*?$/.test(env)) {
    // KaTeX renders align/gather/… only as their starred, inner forms.
    const base = env.replace(/\*$/, '');
    const inner =
      base === 'align' || base === 'flalign' || base === 'eqnarray'
        ? 'aligned'
        : base === 'gather'
          ? 'gathered'
          : base === 'multline'
            ? 'gathered'
            : 'aligned';
    tex = `\\begin{${inner}}${tex}\\end{${inner}}`;
  }
  return { from: start, to: end, tex, display: ctx.kind !== 'inline' };
}

/** Floating live preview of the formula being edited (KaTeX, user macros applied). */
export function mathPreview(index: () => ProjectIndex) {
  const compute = (state: EditorState): Tooltip | null => {
    const sel = state.selection.main;
    if (!sel.empty) return null;
    const region = mathRegionAt(state.doc.toString(), sel.head);
    if (!region) return null;
    return {
      pos: region.to,
      above: false,
      strictSide: false,
      arrow: true,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'lc-math-preview';
        dom.setAttribute('data-testid', 'math-preview');
        dom.setAttribute('aria-live', 'polite');
        void renderMathInto(dom, region.tex, {
          display: region.display,
          macros: index().katexMacros(),
        });
        return { dom };
      },
    };
  };
  return StateField.define<Tooltip | null>({
    create: compute,
    update(value, tr) {
      if (!tr.docChanged && !tr.selection) return value;
      return compute(tr.state);
    },
    provide: (f) => showTooltip.from(f),
  });
}
