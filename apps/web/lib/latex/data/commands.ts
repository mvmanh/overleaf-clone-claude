/**
 * Command catalogue for completion, the symbol palette and math previews.
 *
 * `snippet` uses CodeMirror snippet syntax (`${name}` fields, Tab to move).
 * `glyph` is a Unicode preview; `math` marks math-mode commands; `pkg` names
 * the package that provides the command (none = LaTeX kernel).
 */
export interface CommandSpec {
  name: string;
  snippet?: string;
  glyph?: string;
  detail?: string;
  math?: boolean;
  pkg?: string;
  category: string;
  /** Higher = shown earlier among equal matches. */
  rank?: number;
}

const out: CommandSpec[] = [];

/** "alpha α, beta β" → glyph-only math symbols. */
function symbols(category: string, list: string, pkg?: string, rank = 0) {
  for (const item of list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [name, glyph] = item.split(/\s+/);
    out.push({ name: name!, glyph, math: true, category, ...(pkg ? { pkg } : {}), rank });
  }
}

/** Entries: [name, snippet-args, detail?, glyph?] */
function commands(
  category: string,
  opts: { math?: boolean; pkg?: string; rank?: number },
  list: [string, string?, string?, string?][],
) {
  for (const [name, args, detail, glyph] of list) {
    out.push({
      name,
      // Braces in names (\left\{) must be escaped for the snippet parser.
      ...(args ? { snippet: `\\${name.replace(/[{}]/g, '\\$&')}${args}` } : {}),
      ...(detail ? { detail } : {}),
      ...(glyph ? { glyph } : {}),
      category,
      ...(opts.math ? { math: true } : {}),
      ...(opts.pkg ? { pkg: opts.pkg } : {}),
      rank: opts.rank ?? 0,
    });
  }
}

// ── Greek ────────────────────────────────────────────────────────────────
symbols(
  'Greek',
  `alpha α, beta β, gamma γ, delta δ, epsilon ϵ, varepsilon ε, zeta ζ, eta η, theta θ, vartheta ϑ,
   iota ι, kappa κ, lambda λ, mu μ, nu ν, xi ξ, pi π, varpi ϖ, rho ρ, varrho ϱ, sigma σ, varsigma ς,
   tau τ, upsilon υ, phi ϕ, varphi φ, chi χ, psi ψ, omega ω,
   Gamma Γ, Delta Δ, Theta Θ, Lambda Λ, Xi Ξ, Pi Π, Sigma Σ, Upsilon Υ, Phi Φ, Psi Ψ, Omega Ω`,
  undefined,
  2,
);
symbols('Greek', 'digamma ϝ, varkappa ϰ, varGamma 𝛤, varDelta 𝛥', 'amssymb');

// ── Operators & relations ───────────────────────────────────────────────
symbols(
  'Binary operators',
  `pm ±, mp ∓, times ×, div ÷, cdot ⋅, ast ∗, star ⋆, circ ∘, bullet ∙, oplus ⊕, ominus ⊖, otimes ⊗,
   oslash ⊘, odot ⊙, cap ∩, cup ∪, sqcap ⊓, sqcup ⊔, wedge ∧, vee ∨, setminus ∖, uplus ⊎, amalg ⨿,
   diamond ⋄, bigtriangleup △, bigtriangledown ▽, triangleleft ◁, triangleright ▷, dagger †, ddagger ‡, wr ≀`,
  undefined,
  1,
);
symbols(
  'Binary operators',
  'ltimes ⋉, rtimes ⋊, boxplus ⊞, boxtimes ⊠, dotplus ∔, smallsetminus ∖',
  'amssymb',
);
symbols(
  'Relations',
  `leq ≤, geq ≥, le ≤, ge ≥, neq ≠, ne ≠, equiv ≡, approx ≈, sim ∼, simeq ≃, cong ≅, propto ∝, ll ≪, gg ≫,
   subset ⊂, supset ⊃, subseteq ⊆, supseteq ⊇, in ∈, ni ∋, notin ∉, perp ⊥, parallel ∥, mid ∣,
   vdash ⊢, dashv ⊣, models ⊨, prec ≺, succ ≻, preceq ⪯, succeq ⪰, doteq ≐, asymp ≍, bowtie ⋈,
   sqsubseteq ⊑, sqsupseteq ⊒, smile ⌣, frown ⌢`,
  undefined,
  1,
);
symbols(
  'Relations',
  `leqslant ⩽, geqslant ⩾, lesssim ≲, gtrsim ≳, subsetneq ⊊, supsetneq ⊋, nsubseteq ⊈, nmid ∤, nparallel ∦,
   triangleq ≜, approxeq ≊, thicksim ∼, backsim ∽, vDash ⊨, Vdash ⊩, nleq ≰, ngeq ≱, lll ⋘, ggg ⋙, eqqcolon ≕`,
  'amssymb',
);
symbols('Relations', 'coloneqq ≔, Coloneqq ⩴, eqqcolon ≕', 'mathtools');

// ── Arrows ───────────────────────────────────────────────────────────────
symbols(
  'Arrows',
  `to →, gets ←, rightarrow →, leftarrow ←, leftrightarrow ↔, Rightarrow ⇒, Leftarrow ⇐, Leftrightarrow ⇔,
   implies ⟹, impliedby ⟸, iff ⟺, mapsto ↦, longmapsto ⟼, longrightarrow ⟶, longleftarrow ⟵,
   Longrightarrow ⟹, Longleftarrow ⟸, longleftrightarrow ⟷, uparrow ↑, downarrow ↓, updownarrow ↕,
   Uparrow ⇑, Downarrow ⇓, nearrow ↗, searrow ↘, swarrow ↙, nwarrow ↖, hookrightarrow ↪, hookleftarrow ↩,
   rightharpoonup ⇀, leftharpoonup ↼, rightleftharpoons ⇌, leadsto ⇝`,
  undefined,
  1,
);
symbols(
  'Arrows',
  'twoheadrightarrow ↠, rightsquigarrow ⇝, circlearrowright ↻, curvearrowright ↷, dashrightarrow ⇢',
  'amssymb',
);
commands('Arrows', { math: true }, [
  ['xrightarrow', '{${above}}', 'arrow with text above (amsmath)', '→'],
  ['xleftarrow', '{${above}}', 'arrow with text above (amsmath)', '←'],
  ['overset', '{${above}}{${base}}', 'place over'],
  ['underset', '{${below}}{${base}}', 'place under'],
  ['stackrel', '{${above}}{${relation}}', 'stack over relation'],
]);

// ── Logic, sets, misc symbols ──────────────────────────────────────────
symbols(
  'Logic & sets',
  `forall ∀, exists ∃, neg ¬, lnot ¬, land ∧, lor ∨, emptyset ∅, infty ∞, partial ∂, nabla ∇, top ⊤, bot ⊥,
   aleph ℵ, hbar ℏ, ell ℓ, wp ℘, Re ℜ, Im ℑ, angle ∠, triangle △, prime ′, backslash ∖, imath ı, jmath ȷ,
   ldots …, cdots ⋯, vdots ⋮, ddots ⋱, dots …, surd √, flat ♭, sharp ♯, natural ♮, clubsuit ♣, heartsuit ♡`,
  undefined,
  1,
);
symbols(
  'Logic & sets',
  `nexists ∄, varnothing ∅, therefore ∴, because ∵, complement ∁, square □, blacksquare ■, checkmark ✓,
   mho ℧, beth ℶ, gimel ℷ, measuredangle ∡, lozenge ◊, blacklozenge ⧫, Box □, Diamond ◇`,
  'amssymb',
);

// ── Big operators & functions ───────────────────────────────────────────
commands('Big operators', { math: true, rank: 3 }, [
  ['sum', '_{${i=1}}^{${n}}', 'sum with limits', '∑'],
  ['prod', '_{${i=1}}^{${n}}', 'product with limits', '∏'],
  ['coprod', '_{${i}}', 'coproduct', '∐'],
  ['int', '_{${a}}^{${b}} ${f(x)} \\,\\mathrm{d}${x}', 'integral', '∫'],
  ['oint', '_{${C}} ${f} \\,\\mathrm{d}${s}', 'contour integral', '∮'],
  ['bigcup', '_{${i=1}}^{${n}}', 'big union', '⋃'],
  ['bigcap', '_{${i=1}}^{${n}}', 'big intersection', '⋂'],
  ['bigoplus', '_{${i}}', 'direct sum', '⨁'],
  ['bigotimes', '_{${i}}', 'tensor product', '⨂'],
  ['bigvee', '_{${i}}', '', '⋁'],
  ['bigwedge', '_{${i}}', '', '⋀'],
  ['bigsqcup', '_{${i}}', '', '⨆'],
  ['lim', '_{${n \\to \\infty}}', 'limit', 'lim'],
  ['limsup', '_{${n \\to \\infty}}', '', 'lim sup'],
  ['liminf', '_{${n \\to \\infty}}', '', 'lim inf'],
  ['sup', '_{${x \\in A}}', 'supremum', 'sup'],
  ['inf', '_{${x \\in A}}', 'infimum', 'inf'],
  ['max', '_{${x}}', '', 'max'],
  ['min', '_{${x}}', '', 'min'],
]);
commands('Big operators', { math: true, pkg: 'amsmath', rank: 2 }, [
  ['iint', '_{${D}} ${f} \\,\\mathrm{d}${A}', 'double integral', '∬'],
  ['iiint', '_{${V}} ${f} \\,\\mathrm{d}${V}', 'triple integral', '∭'],
  ['idotsint', '', 'multiple integral', '∫⋯∫'],
]);
symbols(
  'Functions',
  `sin sin, cos cos, tan tan, cot cot, sec sec, csc csc, arcsin arcsin, arccos arccos, arctan arctan,
   sinh sinh, cosh cosh, tanh tanh, coth coth, log log, ln ln, lg lg, exp exp, det det, dim dim, ker ker,
   hom hom, deg deg, gcd gcd, arg arg, Pr Pr, bmod mod`,
  undefined,
  1,
);
commands('Functions', { math: true }, [
  ['pmod', '{${n}}', 'parenthesised modulus', '(mod n)'],
  ['operatorname', '{${name}}', 'upright operator name'],
]);

// ── Structures ───────────────────────────────────────────────────────────
commands('Fractions & roots', { math: true, rank: 4 }, [
  ['frac', '{${num}}{${den}}', 'fraction', 'a⁄b'],
  ['sqrt', '{${x}}', 'square root', '√'],
  ['binom', '{${n}}{${k}}', 'binomial coefficient', '(n k)'],
]);
commands('Fractions & roots', { math: true, pkg: 'amsmath', rank: 2 }, [
  ['dfrac', '{${num}}{${den}}', 'display-style fraction'],
  ['tfrac', '{${num}}{${den}}', 'text-style fraction'],
  ['cfrac', '{${num}}{${den}}', 'continued fraction'],
  ['dbinom', '{${n}}{${k}}', 'display-style binomial'],
  ['tbinom', '{${n}}{${k}}', 'text-style binomial'],
]);
out.push({
  name: 'sqrt[n]',
  snippet: '\\sqrt[${n}]{${x}}',
  detail: 'n-th root',
  glyph: 'ⁿ√',
  math: true,
  category: 'Fractions & roots',
  rank: 3,
});

commands('Delimiters', { math: true, rank: 3 }, [
  ['left(', ' ${} \\right)', 'auto-sized ( )', '( )'],
  ['left[', ' ${} \\right]', 'auto-sized [ ]', '[ ]'],
  ['left\\{', ' ${} \\right\\\\}', 'auto-sized { }', '{ }'],
  ['left|', ' ${} \\right|', 'auto-sized | |', '| |'],
  ['left\\lVert', ' ${} \\right\\rVert', 'auto-sized norm', '‖ ‖'],
  ['left\\langle', ' ${} \\right\\rangle', 'auto-sized ⟨ ⟩', '⟨ ⟩'],
  ['left\\lfloor', ' ${} \\right\\rfloor', 'auto-sized floor', '⌊ ⌋'],
  ['left\\lceil', ' ${} \\right\\rceil', 'auto-sized ceiling', '⌈ ⌉'],
  ['left.', ' ${} \\right|_{${x=a}}', 'evaluation bar', '|ₓ'],
  ['middle', '|', 'auto-sized middle bar'],
]);
symbols(
  'Delimiters',
  'langle ⟨, rangle ⟩, lfloor ⌊, rfloor ⌋, lceil ⌈, rceil ⌉, lvert |, rvert |, lVert ‖, rVert ‖, vert |, Vert ‖',
  'amsmath',
  1,
);
commands('Delimiters', { math: true }, [
  ['big', '(', 'bigger delimiter'],
  ['Big', '(', ''],
  ['bigg', '(', ''],
  ['Bigg', '(', ''],
]);

commands('Accents', { math: true, rank: 2 }, [
  ['hat', '{${x}}', 'hat accent', 'x̂'],
  ['widehat', '{${xy}}', 'wide hat', 'x̂'],
  ['bar', '{${x}}', 'bar accent', 'x̄'],
  ['overline', '{${x}}', 'overline', 'x̅'],
  ['underline', '{${x}}', 'underline', 'x̲'],
  ['tilde', '{${x}}', 'tilde accent', 'x̃'],
  ['widetilde', '{${xy}}', 'wide tilde', 'x̃'],
  ['vec', '{${v}}', 'vector arrow', 'v⃗'],
  ['dot', '{${x}}', 'time derivative', 'ẋ'],
  ['ddot', '{${x}}', 'second derivative', 'ẍ'],
  ['acute', '{${x}}', '', 'x́'],
  ['grave', '{${x}}', '', 'x̀'],
  ['breve', '{${x}}', '', 'x̆'],
  ['check', '{${x}}', '', 'x̌'],
  ['mathring', '{${x}}', '', 'x̊'],
  ['overrightarrow', '{${AB}}', 'arrow over', 'AB⃗'],
  ['overleftarrow', '{${AB}}', '', 'AB⃖'],
  ['overbrace', '{${expr}}^{${label}}', 'brace above', '⏞'],
  ['underbrace', '{${expr}}_{${label}}', 'brace below', '⏟'],
  ['boxed', '{${expr}}', 'framed formula (amsmath)', '▭'],
  ['not', '', 'negate next relation', '/'],
]);
commands('Accents', { math: true, pkg: 'amsmath' }, [
  ['dddot', '{${x}}', 'third derivative', 'x⃛'],
]);
commands('Accents', { math: true, pkg: 'cancel' }, [
  ['cancel', '{${x}}', 'strike through', 'x̸'],
  ['bcancel', '{${x}}', ''],
  ['cancelto', '{${value}}{${x}}', 'cancel with arrow'],
]);

commands('Math fonts', { math: true, rank: 3 }, [
  ['mathbf', '{${x}}', 'bold', '𝐱'],
  ['mathrm', '{${x}}', 'upright', 'x'],
  ['mathit', '{${x}}', 'italic', '𝑥'],
  ['mathsf', '{${x}}', 'sans-serif', '𝗑'],
  ['mathtt', '{${x}}', 'monospace', '𝚡'],
  ['mathcal', '{${A}}', 'calligraphic', '𝒜'],
  ['text', '{${text}}', 'text inside math (amsmath)'],
  ['displaystyle', '', 'display style'],
  ['textstyle', '', 'text style'],
]);
commands('Math fonts', { math: true, pkg: 'amssymb', rank: 3 }, [
  ['mathbb', '{${R}}', 'blackboard bold', 'ℝ'],
  ['mathfrak', '{${g}}', 'Fraktur', '𝔤'],
]);
commands('Math fonts', { math: true, pkg: 'mathrsfs' }, [['mathscr', '{${L}}', 'script', '𝓛']]);
commands('Math fonts', { math: true, pkg: 'amsmath' }, [
  ['boldsymbol', '{${\\alpha}}', 'bold symbol', '𝛂'],
]);
commands('Math fonts', { math: true, pkg: 'bm' }, [['bm', '{${\\alpha}}', 'bold math', '𝛂']]);
commands('Math fonts', { math: true, pkg: 'dsfont' }, [['mathds', '{${1}}', 'double-struck', '𝟙']]);

commands('Spacing & layout', { math: true }, [
  ['quad', '', '1em space', '␣'],
  ['qquad', '', '2em space', '␣␣'],
  [',', '', 'thin space'],
  [';', '', 'thick space'],
  [':', '', 'medium space'],
  ['!', '', 'negative thin space'],
  ['limits', '', 'limits above/below'],
  ['nolimits', '', 'limits as sub/superscripts'],
  ['phantom', '{${x}}', 'invisible box with size'],
  ['smash', '{${x}}', 'zero height'],
  ['tag', '{${1}}', 'custom equation number (amsmath)'],
  ['notag', '', 'no number on this line (amsmath)'],
  ['nonumber', '', 'no number on this line'],
  ['intertext', '{${text}}', 'text between aligned lines (amsmath)'],
  ['substack', '{${i<n} \\\\ ${j<m}}', 'multi-line limits (amsmath)'],
]);

// ── Package-specific math ────────────────────────────────────────────────
commands('physics', { math: true, pkg: 'physics', rank: 1 }, [
  ['dv', '{${f}}{${x}}', 'derivative d f / d x'],
  ['pdv', '{${f}}{${x}}', 'partial derivative'],
  ['abs', '{${x}}', 'absolute value |x|'],
  ['norm', '{${x}}', 'norm ‖x‖'],
  ['ket', '{${\\psi}}', 'ket |ψ⟩'],
  ['bra', '{${\\phi}}', 'bra ⟨φ|'],
  ['braket', '{${\\phi}}{${\\psi}}', 'inner product ⟨φ|ψ⟩'],
  ['expval', '{${A}}', 'expectation ⟨A⟩'],
  ['comm', '{${A}}{${B}}', 'commutator [A,B]'],
  ['vb', '{${v}}', 'bold vector'],
  ['grad', '', 'gradient ∇'],
  ['divergence', '', 'divergence ∇·'],
  ['curl', '', 'curl ∇×'],
  ['laplacian', '', 'Laplacian ∇²'],
  ['order', '{${x^2}}', 'big-O 𝒪(x²)'],
]);
commands('derivative', { math: true, pkg: 'derivative' }, [
  ['odv', '{${f}}{${x}}', 'ordinary derivative'],
  ['pdv', '{${f}}{${x}}', 'partial derivative'],
]);
commands('siunitx', { pkg: 'siunitx', rank: 1 }, [
  ['SI', '{${9.81}}{${\\metre\\per\\second\\squared}}', 'number with unit (v2)'],
  ['si', '{${\\kilo\\gram}}', 'unit (v2)'],
  ['qty', '{${9.81}}{${\\metre\\per\\second\\squared}}', 'quantity (v3)'],
  ['unit', '{${\\kilo\\gram}}', 'unit (v3)'],
  ['num', '{${1.23e4}}', 'formatted number'],
  ['ang', '{${30}}', 'angle in degrees'],
]);
commands('mathtools', { math: true, pkg: 'mathtools' }, [
  [
    'DeclarePairedDelimiter',
    '{\\${abs}}{${\\lvert}}{${\\rvert}}',
    'define \\abs, \\abs*, \\abs[\\big]',
  ],
  ['mathclap', '{${x}}', 'zero-width centred'],
  ['xRightarrow', '{${above}}', 'extensible ⇒'],
  ['shortintertext', '{${text}}', 'compact text between lines'],
]);
commands('amsthm', { pkg: 'amsthm' }, [
  ['qedhere', '', 'put ∎ here in a proof'],
  ['theoremstyle', '{${definition}}', 'plain | definition | remark'],
]);

// ── Document structure & text ──────────────────────────────────────────
commands('Structure', { rank: 4 }, [
  ['documentclass', '[${11pt}]{${article}}', 'document class'],
  ['usepackage', '{${package}}', 'load a package'],
  ['title', '{${title}}', ''],
  ['author', '{${name}}', ''],
  ['date', '{${\\today}}', ''],
  ['maketitle', '', 'print the title block'],
  ['tableofcontents', '', ''],
  ['listoffigures', '', ''],
  ['listoftables', '', ''],
  ['part', '{${title}}', ''],
  ['chapter', '{${title}}', ''],
  ['section', '{${title}}', ''],
  ['subsection', '{${title}}', ''],
  ['subsubsection', '{${title}}', ''],
  ['paragraph', '{${title}}', ''],
  ['section*', '{${title}}', 'unnumbered section'],
  ['subsection*', '{${title}}', 'unnumbered subsection'],
  ['appendix', '', 'start appendices'],
  ['input', '{${file}}', 'insert a file'],
  ['include', '{${file}}', 'insert a file on a new page'],
  ['label', '{${key}}', 'label for cross-references'],
  ['ref', '{${key}}', 'reference a label'],
  ['eqref', '{${key}}', 'reference an equation (amsmath)'],
  ['pageref', '{${key}}', 'page of a label'],
  ['footnote', '{${text}}', ''],
  ['caption', '{${text}}', ''],
  ['item', ' ', 'list item'],
  ['newcommand', '{\\${name}}[${1}]{${definition}}', 'define a macro'],
  ['renewcommand', '{\\${name}}{${definition}}', 'redefine a macro'],
  ['newenvironment', '{${name}}{${begin}}{${end}}', 'define an environment'],
  ['newtheorem', '{${theorem}}{${Theorem}}[${section}]', 'define a theorem environment'],
  ['DeclareMathOperator', '{\\${op}}{${op}}', 'define an operator (amsmath)'],
  ['today', '', "today's date"],
  ['centering', '', ''],
  ['noindent', '', ''],
  ['newpage', '', ''],
  ['clearpage', '', ''],
  ['vspace', '{${1em}}', 'vertical space'],
  ['hspace', '{${1em}}', 'horizontal space'],
  ['vfill', '', ''],
  ['hfill', '', ''],
  ['smallskip', '', ''],
  ['medskip', '', ''],
  ['bigskip', '', ''],
  ['linewidth', '', 'width of the current line'],
  ['textwidth', '', 'width of the text block'],
  ['setlength', '{\\${parindent}}{${0pt}}', ''],
  ['setcounter', '{${secnumdepth}}{${3}}', ''],
]);
commands('Text formatting', { rank: 3 }, [
  ['textbf', '{${text}}', 'bold (Ctrl+B)'],
  ['textit', '{${text}}', 'italic (Ctrl+I)'],
  ['emph', '{${text}}', 'emphasis'],
  ['underline', '{${text}}', 'underline'],
  ['texttt', '{${text}}', 'monospace'],
  ['textsc', '{${text}}', 'small caps'],
  ['textsf', '{${text}}', 'sans-serif'],
  ['textrm', '{${text}}', 'roman'],
  ['textsuperscript', '{${text}}', ''],
  ['textsubscript', '{${text}}', ''],
  ['tiny', '', 'font size'],
  ['scriptsize', '', 'font size'],
  ['footnotesize', '', 'font size'],
  ['small', '', 'font size'],
  ['normalsize', '', 'font size'],
  ['large', '', 'font size'],
  ['Large', '', 'font size'],
  ['LARGE', '', 'font size'],
  ['huge', '', 'font size'],
  ['Huge', '', 'font size'],
  ['textendash', '', '–'],
  ['textemdash', '', '—'],
  ['LaTeX', '', 'LaTeX logo'],
  ['verb', '|${code}|', 'inline verbatim'],
]);
commands('Citations', { rank: 4 }, [
  ['cite', '{${key}}', 'citation'],
  ['nocite', '{${*}}', 'include without citing'],
  ['bibliography', '{${refs}}', 'BibTeX database'],
  ['bibliographystyle', '{${plain}}', 'BibTeX style'],
]);
commands('Citations', { pkg: 'natbib', rank: 3 }, [
  ['citep', '{${key}}', '(Author, Year)'],
  ['citet', '{${key}}', 'Author (Year)'],
  ['citealp', '{${key}}', 'Author, Year'],
  ['citeauthor', '{${key}}', 'Author'],
  ['citeyear', '{${key}}', 'Year'],
]);
commands('Citations', { pkg: 'biblatex', rank: 3 }, [
  ['parencite', '{${key}}', '(Author, Year)'],
  ['textcite', '{${key}}', 'Author (Year)'],
  ['autocite', '{${key}}', 'style-dependent citation'],
  ['footcite', '{${key}}', 'citation in a footnote'],
  ['fullcite', '{${key}}', 'full reference inline'],
  ['addbibresource', '{${refs.bib}}', 'biblatex database'],
  ['printbibliography', '', 'print the bibliography'],
]);
commands('References', { pkg: 'cleveref', rank: 3 }, [
  ['cref', '{${key}}', 'clever reference: "eq. (1)"'],
  ['Cref', '{${key}}', 'clever reference, capitalised'],
  ['crefrange', '{${a}}{${b}}', 'range of references'],
]);
commands('References', { pkg: 'hyperref', rank: 2 }, [
  ['autoref', '{${key}}', 'reference with type name'],
  ['nameref', '{${key}}', 'reference by title'],
  ['href', '{${url}}{${text}}', 'hyperlink'],
  ['url', '{${url}}', 'URL'],
]);
commands('References', { pkg: 'varioref' }, [['vref', '{${key}}', 'reference with page']]);
commands('Graphics', { pkg: 'graphicx', rank: 4 }, [
  ['includegraphics', '[width=${0.8}\\linewidth]{${file}}', 'insert an image'],
  ['graphicspath', '{{${figures/}}}', 'image search folders'],
  ['rotatebox', '{${90}}{${content}}', ''],
  ['scalebox', '{${0.8}}{${content}}', ''],
]);
commands('Colour', { pkg: 'xcolor' }, [
  ['textcolor', '{${red}}{${text}}', 'coloured text'],
  ['color', '{${red}}', 'switch colour'],
  ['colorbox', '{${yellow}}{${text}}', 'coloured box'],
  ['definecolor', '{${name}}{${HTML}}{${1F6F5C}}', ''],
]);
commands('Tables', { pkg: 'booktabs', rank: 2 }, [
  ['toprule', '', 'table top rule'],
  ['midrule', '', 'table middle rule'],
  ['bottomrule', '', 'table bottom rule'],
  ['cmidrule', '(${lr}){${2-3}}', 'partial rule'],
]);
commands('Tables', {}, [
  ['hline', '', 'horizontal line'],
  ['cline', '{${2-3}}', 'partial horizontal line'],
  ['multicolumn', '{${2}}{${c}}{${text}}', 'merge columns'],
]);
commands('Tables', { pkg: 'multirow' }, [['multirow', '{${2}}{*}{${text}}', 'merge rows']]);
commands('Algorithms', { pkg: 'algpseudocode', rank: 1 }, [
  ['State', ' ', 'statement'],
  ['If', '{${condition}}', ''],
  ['ElsIf', '{${condition}}', ''],
  ['Else', '', ''],
  ['EndIf', '', ''],
  ['For', '{${i \\gets 1}}', ''],
  ['ForAll', '{${x \\in S}}', ''],
  ['EndFor', '', ''],
  ['While', '{${condition}}', ''],
  ['EndWhile', '', ''],
  ['Repeat', '', ''],
  ['Until', '{${condition}}', ''],
  ['Procedure', '{${Name}}{${args}}', ''],
  ['EndProcedure', '', ''],
  ['Function', '{${Name}}{${args}}', ''],
  ['EndFunction', '', ''],
  ['Return', ' ${value}', ''],
  ['Call', '{${Name}}{${args}}', ''],
  ['Require', ' ${input}', ''],
  ['Ensure', ' ${output}', ''],
  ['Comment', '{${text}}', ''],
]);
commands('Algorithms', { math: true }, [['gets', '', 'assignment ←', '←']]);
commands('TikZ', { pkg: 'tikz' }, [
  ['draw', ' (${0,0}) -- (${1,1});', 'draw a path'],
  ['node', ' at (${0,0}) {${text}};', 'place a node'],
  ['fill', '[${gray}] (${0,0}) circle (${2pt});', 'filled shape'],
  ['coordinate', ' (${A}) at (${0,0});', ''],
  ['foreach', ' \\${x} in {${1,...,5}} {${}}', 'loop'],
  ['usetikzlibrary', '{${positioning}}', 'load TikZ libraries'],
]);
commands('TikZ', { pkg: 'pgfplots' }, [['addplot', ' {${x^2}};', 'plot an expression']]);
commands('Beamer', { pkg: 'class:beamer' }, [
  ['frametitle', '{${title}}', ''],
  ['pause', '', ''],
  ['alert', '{${text}}', ''],
  ['only', '<${2-}>{${content}}', ''],
  ['onslide', '<${2-}>', ''],
  ['titlepage', '', ''],
  ['usetheme', '{${metropolis}}', ''],
]);
commands('Misc', { pkg: 'todonotes' }, [['todo', '{${note}}', 'margin note']]);
commands('Misc', { pkg: 'listings' }, [
  ['lstinline', '|${code}|', 'inline code'],
  ['lstinputlisting', '[language=${Python}]{${file}}', 'code from file'],
]);
commands('Misc', { pkg: 'lipsum' }, [['lipsum', '[${1-2}]', 'dummy text']]);

export const COMMANDS: readonly CommandSpec[] = out;

/** Unique, glyph-bearing math symbols grouped for the symbol palette. */
export function paletteCategories(): { category: string; items: CommandSpec[] }[] {
  const groups = new Map<string, CommandSpec[]>();
  for (const c of COMMANDS) {
    if (!c.math || !c.glyph) continue;
    const list = groups.get(c.category) ?? [];
    if (!list.some((x) => x.name === c.name)) list.push(c);
    groups.set(c.category, list);
  }
  return [...groups].map(([category, items]) => ({ category, items }));
}
