import type { ProjectTemplate, TexEngineName } from '@latex-cloud/shared';

export interface TemplateFile {
  path: string;
  content: string;
}

const preambleFonts = (engine: TexEngineName) =>
  engine === 'pdflatex'
    ? String.raw`\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}`
    : String.raw`\usepackage{fontspec}`;

/** Starter files for a new project. Root file is always `main.tex`. */
export function templateFiles(
  template: ProjectTemplate,
  title: string,
  engine: TexEngineName,
): TemplateFile[] {
  // Titles are user input: escape TeX specials so the starter always compiles.
  const safeTitle = title.replace(/[\\{}$&#^_%~]/g, (c) =>
    c === '\\'
      ? String.raw`\textbackslash{}`
      : c === '~'
        ? String.raw`\textasciitilde{}`
        : c === '^'
          ? String.raw`\textasciicircum{}`
          : `\\${c}`,
  );

  switch (template) {
    case 'blank':
      return [
        {
          path: 'main.tex',
          content: String.raw`\documentclass{article}
${preambleFonts(engine)}

\begin{document}

\end{document}
`,
        },
      ];
    case 'article':
      return [
        {
          path: 'main.tex',
          content: String.raw`\documentclass[11pt]{article}
${preambleFonts(engine)}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{hyperref}

\title{${safeTitle}}
\author{}
\date{\today}

\begin{document}
\maketitle

\section{Introduction}
Start writing here. Inline math looks like $e^{i\pi} + 1 = 0$, and displayed math like
\begin{equation}
  \int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}.
\end{equation}

\end{document}
`,
        },
      ];
    case 'math':
      return [
        {
          path: 'main.tex',
          content: String.raw`\documentclass[11pt]{amsart}
${preambleFonts(engine)}
\usepackage{amssymb,mathtools}
\usepackage{hyperref}
\usepackage{cleveref}

\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\newtheorem{proposition}[theorem]{Proposition}
\newtheorem{corollary}[theorem]{Corollary}
\theoremstyle{definition}
\newtheorem{definition}[theorem]{Definition}
\theoremstyle{remark}
\newtheorem{remark}[theorem]{Remark}

\newcommand{\R}{\mathbb{R}}
\newcommand{\N}{\mathbb{N}}

\title{${safeTitle}}
\author{}

\begin{document}
\maketitle

\section{Preliminaries}
\begin{definition}\label{def:bounded}
A sequence $(a_n)_{n\in\N} \subset \R$ is \emph{bounded} if $\sup_n |a_n| < \infty$.
\end{definition}

\begin{theorem}[Bolzano--Weierstrass]\label{thm:bw}
Every bounded sequence in $\R$ has a convergent subsequence.
\end{theorem}

\begin{proof}
See any analysis textbook; compare \cref{def:bounded}.
\end{proof}

\end{document}
`,
        },
      ];
    case 'cs':
      return [
        {
          path: 'main.tex',
          content: String.raw`\documentclass[11pt]{article}
${preambleFonts(engine)}
\usepackage{amsmath,amssymb}
\usepackage{algorithm}
\usepackage{algpseudocode}
\usepackage{listings}
\usepackage{hyperref}
\usepackage{cleveref}
\usepackage[backend=biber,style=numeric]{biblatex}
\addbibresource{references.bib}

\lstset{basicstyle=\ttfamily\small, frame=single, breaklines=true}

\title{${safeTitle}}
\author{}

\begin{document}
\maketitle

\section{Introduction}
Binary search~\cite{knuth1998} is shown in \cref{alg:bsearch}.

\begin{algorithm}
\caption{Binary search}\label{alg:bsearch}
\begin{algorithmic}[1]
\Function{Search}{$A[0..n), x$}
  \State $lo \gets 0$, $hi \gets n$
  \While{$lo < hi$}
    \State $mid \gets \lfloor (lo + hi)/2 \rfloor$
    \If{$A[mid] < x$} \State $lo \gets mid + 1$ \Else \State $hi \gets mid$ \EndIf
  \EndWhile
  \State \Return $lo$
\EndFunction
\end{algorithmic}
\end{algorithm}

\printbibliography
\end{document}
`,
        },
        {
          path: 'references.bib',
          content: String.raw`@book{knuth1998,
  author    = {Donald E. Knuth},
  title     = {The Art of Computer Programming, Volume 3: Sorting and Searching},
  edition   = {2},
  publisher = {Addison-Wesley},
  year      = {1998}
}
`,
        },
      ];
  }
}
