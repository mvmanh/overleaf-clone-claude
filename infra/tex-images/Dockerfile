# latex-cloud compile sandbox image.
#
# Reproducibility: the base image is pinned by digest and, when
# UBUNTU_SNAPSHOT is set, apt resolves against a fixed snapshot.ubuntu.com
# timestamp so a rebuild yields the same TeX Live package versions. Bump both
# deliberately and re-run the fixture suite.
# The orchestrator records the built image's content digest in every revision
# manifest (see compiler-protocol RevisionManifest.texImage).
ARG BASE_IMAGE=ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852
FROM ${BASE_IMAGE}

# Set to e.g. 20261015T000000Z to resolve packages from snapshot.ubuntu.com
# (apt >= 2.7 supports `--snapshot`). Empty uses the regular mirrors.
ARG UBUNTU_SNAPSHOT=""

SHELL ["/bin/sh", "-eux", "-c"]

RUN SNAP=""; if [ -n "$UBUNTU_SNAPSHOT" ]; then SNAP="--snapshot $UBUNTU_SNAPSHOT"; fi; \
    apt-get $SNAP update; \
    DEBIAN_FRONTEND=noninteractive apt-get $SNAP install -y --no-install-recommends \
      latexmk biber \
      texlive-latex-base texlive-latex-recommended texlive-latex-extra \
      texlive-fonts-recommended fonts-lmodern fonts-texgyre \
      texlive-science texlive-pictures texlive-bibtex-extra texlive-publishers \
      texlive-xetex texlive-luatex texlive-lang-greek texlive-lang-other \
      texlive-plain-generic \
      fontconfig tar coreutils findutils; \
    rm -rf /var/lib/apt/lists/* /usr/share/doc /usr/share/man; \
    # Warm caches at build time so compiles never write them (root fs is read-only).
    fc-cache -f; \
    luaotfload-tool --update --force || true; \
    mktexlsr

COPY latexmkrc /etc/latex-cloud/latexmkrc
COPY lc-compile /usr/local/bin/lc-compile
RUN chmod 0444 /etc/latex-cloud/latexmkrc && chmod 0555 /usr/local/bin/lc-compile; \
    groupadd --gid 10001 tex && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin tex

# kpathsea overrides: no shell escape; reads/writes only inside the workspace.
ENV shell_escape=f \
    openout_any=p \
    openin_any=p \
    max_print_line=10000 \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

USER 10001:10001
WORKDIR /work
ENTRYPOINT ["/usr/local/bin/lc-compile"]
LABEL org.opencontainers.image.title="latex-cloud-texlive" \
      org.opencontainers.image.description="Network-less TeX Live compile sandbox image (run with --read-only --network=none)"
