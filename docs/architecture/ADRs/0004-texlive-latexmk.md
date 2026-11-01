# ADR-0004: TeX Live + latexmk as the build driver

- Status: Accepted (2026-11-01)

## Decision

Distribution TeX Live packages in a pinned image (`infra/tex-images`), driven by `latexmk` with pdfLaTeX/XeLaTeX/LuaLaTeX and BibTeX/Biber. Tectonic is a possible future engine experiment, not the default.

latexmk is always invoked as `latexmk -norc -r /etc/latex-cloud/latexmkrc …`: project `latexmkrc` files are Perl and would be arbitrary code execution, so they are never read (they are also rejected at the path-validation layer).

## Consequences

Maximum package compatibility. Image is large (~1.7 GB uncompressed); acceptable for a warm worker pool. The base image is pinned by digest and apt can be pinned to a snapshot timestamp (`UBUNTU_SNAPSHOT`).

Base image note: Ubuntu 24.04 (TeX Live 2023) was chosen over Debian because it builds in our current CI/dev environments; switching distributions is a deliberate, fixture-gated change.
