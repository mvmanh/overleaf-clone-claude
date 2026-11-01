/**
 * Auto-expanding snippets: they fire as soon as the trigger is typed, without
 * opening the completion list. Each expansion is its own undo step, so
 * Ctrl/Cmd+Z restores exactly what was typed.
 */
export interface AutoRule {
  /** Literal suffix, or a RegExp anchored with `$` tested against the text before the cursor. */
  trigger: string | RegExp;
  /** Snippet template; for RegExp triggers `$1`… refer to capture groups. */
  replace: string;
  mode: 'math' | 'text';
  /** Literal trigger must not follow a letter or backslash (so `\sum` or "summary" never fire). */
  word?: boolean;
  /** Only when nothing but whitespace precedes the trigger on its line. */
  lineStart?: boolean;
  description: string;
  /** What to type → what you get, for the cheat sheet. */
  example: [string, string];
}

const greek: [string, string][] = [
  ['a', 'alpha'],
  ['b', 'beta'],
  ['g', 'gamma'],
  ['d', 'delta'],
  ['e', 'epsilon'],
  ['z', 'zeta'],
  ['h', 'eta'],
  ['q', 'theta'],
  ['i', 'iota'],
  ['k', 'kappa'],
  ['l', 'lambda'],
  ['m', 'mu'],
  ['n', 'nu'],
  ['x', 'xi'],
  ['p', 'pi'],
  ['r', 'rho'],
  ['s', 'sigma'],
  ['t', 'tau'],
  ['u', 'upsilon'],
  ['f', 'phi'],
  ['c', 'chi'],
  ['y', 'psi'],
  ['o', 'omega'],
  ['G', 'Gamma'],
  ['D', 'Delta'],
  ['Q', 'Theta'],
  ['L', 'Lambda'],
  ['X', 'Xi'],
  ['P', 'Pi'],
  ['S', 'Sigma'],
  ['U', 'Upsilon'],
  ['F', 'Phi'],
  ['Y', 'Psi'],
  ['O', 'Omega'],
];

const lit = (
  trigger: string,
  replace: string,
  description: string,
  word = false,
  example?: [string, string],
): AutoRule => ({
  trigger,
  replace,
  mode: 'math',
  word,
  description,
  example: example ?? [trigger, replace.replace(/\$\{[^}]*\}/g, '')],
});

export const AUTO_RULES: readonly AutoRule[] = [
  // Entering math from text
  {
    trigger: 'mk',
    replace: '$${}$',
    mode: 'text',
    word: true,
    description: 'inline math',
    example: ['mk', '$…$'],
  },
  {
    trigger: 'dm',
    replace: '\\[\n\t${}\n\\]',
    mode: 'text',
    word: true,
    lineStart: true,
    description: 'display math',
    example: ['dm', '\\[ … \\]'],
  },
  {
    trigger: 'beg',
    replace: '\\begin{${env}}\n\t${}\n\\end{${env}}',
    mode: 'text',
    word: true,
    lineStart: true,
    description: 'any environment (name typed once)',
    example: ['beg', '\\begin{…}…\\end{…}'],
  },

  // Fractions, scripts
  lit('//', '\\frac{${}}{${}}', 'fraction'),
  lit('ff', '\\frac{${}}{${}}', 'fraction', true),
  lit('sr', '^2', 'squared', true),
  lit('cb', '^3', 'cubed', true),
  lit('td', '^{${}}', 'superscript', true),
  lit('__', '_{${}}', 'subscript'),
  lit('invs', '^{-1}', 'inverse', true),
  lit('TT', '^{\\top}', 'transpose', true),
  {
    trigger: /(?<![\\A-Za-z])([A-Za-z])(\d)$/,
    replace: '$1_$2',
    mode: 'math',
    description: 'automatic subscript',
    example: ['x1', 'x_1'],
  },
  {
    trigger: /([A-Za-z])_(\d\d)$/,
    replace: '$1_{$2}',
    mode: 'math',
    description: 'two-digit subscript',
    example: ['x_12', 'x_{12}'],
  },
  {
    trigger: /(?<![\\A-Za-z])([A-Za-z])(hat|bar|vec|dot|ddot|tilde)$/,
    replace: '\\$2{$1}',
    mode: 'math',
    description: 'postfix accent (bar → overline)',
    example: ['xhat', '\\hat{x}'],
  },

  // Relations, arrows, operators
  lit('<=', '\\leq ', '≤', false, ['<=', '\\leq']),
  lit('>=', '\\geq ', '≥', false, ['>=', '\\geq']),
  lit('!=', '\\neq ', '≠', false, ['!=', '\\neq']),
  lit('~~', '\\approx ', '≈', false, ['~~', '\\approx']),
  lit('~=', '\\cong ', '≅', false, ['~=', '\\cong']),
  lit('<<', '\\ll ', '≪', false, ['<<', '\\ll']),
  lit('>>', '\\gg ', '≫', false, ['>>', '\\gg']),
  lit('->', '\\to ', '→', false, ['->', '\\to']),
  lit('<->', '\\leftrightarrow ', '↔', false, ['<->', '\\leftrightarrow']),
  lit('!>', '\\mapsto ', '↦', false, ['!>', '\\mapsto']),
  lit('=>', '\\implies ', '⟹', false, ['=>', '\\implies']),
  lit('=<', '\\impliedby ', '⟸', false, ['=<', '\\impliedby']),
  lit('iff', '\\iff ', '⟺', true, ['iff', '\\iff']),
  lit('+-', '\\pm ', '±', false, ['+-', '\\pm']),
  lit('-+', '\\mp ', '∓', false, ['-+', '\\mp']),
  lit('**', '\\cdot ', '·', false, ['**', '\\cdot']),
  lit('xx', '\\times ', '×', true, ['xx', '\\times']),
  lit('...', '\\dots ', '…', false, ['...', '\\dots']),
  lit('oo', '\\infty', '∞', true),
  lit('inn', '\\in ', '∈', true, ['inn', '\\in']),
  lit('notin', '\\notin ', '∉', true, ['notin', '\\notin']),
  lit('sub=', '\\subseteq ', '⊆', true, ['sub=', '\\subseteq']),
  lit('sup=', '\\supseteq ', '⊇', true, ['sup=', '\\supseteq']),
  lit('EE', '\\exists ', '∃', true, ['EE', '\\exists']),
  lit('AA', '\\forall ', '∀', true, ['AA', '\\forall']),
  lit('nabl', '\\nabla ', '∇', true, ['nabl', '\\nabla']),
  lit('del', '\\partial ', '∂', true, ['del', '\\partial']),

  // Number sets
  ...['R', 'N', 'Z', 'Q', 'C'].map((L) =>
    lit(`${L}${L}`, `\\mathbb{${L}}`, `ℝℕℤℚℂ`['RNZQC'.indexOf(L)]!, true),
  ),

  // Structures
  lit('sq', '\\sqrt{${}}', 'square root', true),
  lit('lr(', '\\left( ${} \\right)', 'sized ( )', true),
  lit('lr[', '\\left[ ${} \\right]', 'sized [ ]', true),
  lit('lr{', '\\left\\\\{ ${} \\right\\\\}', 'sized { }', true, ['lr{', '\\left\\{ \\right\\}']),
  lit('lr|', '\\left| ${} \\right|', 'sized | |', true),
  lit('lra', '\\left\\langle ${} \\right\\rangle', 'sized ⟨ ⟩', true),
  lit('sum', '\\sum_{${i=1}}^{${n}} ', 'sum', true),
  lit('prod', '\\prod_{${i=1}}^{${n}} ', 'product', true),
  lit('lim', '\\lim_{${n} \\to ${\\infty}} ', 'limit', true),
  lit('dint', '\\int_{${a}}^{${b}} ${} \\,\\mathrm{d}${x}', 'definite integral', true),
  lit('part', '\\frac{\\partial ${f}}{\\partial ${x}}', 'partial derivative', true),
  lit('ddx', '\\frac{\\mathrm{d}${f}}{\\mathrm{d}${x}}', 'derivative', true),
  lit('tt', '\\text{${}}', 'text inside math', true),
  lit('pmat', '\\begin{pmatrix} ${} \\end{pmatrix}', 'matrix ( )', true),
  lit('bmat', '\\begin{bmatrix} ${} \\end{bmatrix}', 'matrix [ ]', true),
  lit('cases', '\\begin{cases} ${} & ${} \\\\ ${} & ${} \\end{cases}', 'cases', true, [
    'cases',
    '\\begin{cases}…',
  ]),

  // Greek: @a → \alpha
  ...greek.map(([k, name]) => lit(`@${k}`, `\\${name}`, name, false, [`@${k}`, `\\${name}`])),
  lit('@ve', '\\varepsilon', 'varepsilon', false, ['@ve', '\\varepsilon']),
  lit('@vf', '\\varphi', 'varphi', false, ['@vf', '\\varphi']),
  lit('@vq', '\\vartheta', 'vartheta', false, ['@vq', '\\vartheta']),
];

export interface AutoMatch {
  rule: AutoRule;
  /** Length of the trigger text (to replace) before the cursor. */
  length: number;
  /** Snippet template with captures substituted. */
  template: string;
}

/**
 * Finds the rule that fires for `before` (text of the current line before the
 * cursor, including the character just typed). The longest literal trigger wins.
 */
export function findAutoExpansion(
  before: string,
  mode: 'math' | 'text',
  rules: readonly AutoRule[] = AUTO_RULES,
): AutoMatch | null {
  let best: AutoMatch | null = null;
  for (const rule of rules) {
    if (rule.mode !== mode) continue;
    if (typeof rule.trigger === 'string') {
      if (!before.endsWith(rule.trigger)) continue;
      const prev = before[before.length - rule.trigger.length - 1];
      // Never inside a command name, a word, or right after `{` (e.g. \begin{cases}).
      if (rule.word && prev !== undefined && /[A-Za-z\\@{]/.test(prev)) continue;
      if (
        rule.lineStart &&
        !/(^|\n)[ \t]*$/.test(before.slice(0, before.length - rule.trigger.length))
      )
        continue;
      if (!best || rule.trigger.length > best.length) {
        best = { rule, length: rule.trigger.length, template: rule.replace };
      }
    } else {
      const m = rule.trigger.exec(before);
      if (!m) continue;
      const template = rule.replace.replace(/\$(\d)/g, (_, n: string) => m[Number(n)] ?? '');
      const fixed = template === '\\bar{' + m[1] + '}' ? `\\overline{${m[1]}}` : template;
      if (!best || m[0].length > best.length) best = { rule, length: m[0].length, template: fixed };
    }
  }
  return best;
}
