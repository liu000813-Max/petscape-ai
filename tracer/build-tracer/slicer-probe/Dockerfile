# WP-2.0 tracer: heavy tool layer executability probe (ADR-0001 verification
# condition 2). Verifies uv+trimesh and the PrusaSlicer CLI can be installed
# and run once against a sample mesh on the ECS's actual architecture
# (x86_64 / linux/amd64). Executability only — no business logic wired in.
#
# Build context MUST be this directory, e.g.:
#   docker build --platform linux/amd64 -f tracer/build-tracer/slicer-probe/Dockerfile \
#     -t petscape-slicer-tracer:latest tracer/build-tracer/slicer-probe

FROM debian:bookworm-slim

# The default plain-HTTP deb.debian.org "main" index (~9MB compressed)
# reproducibly truncated (500 / unexpected EOF from the same Fastly edge IP,
# 5/5 retries) under this host's QEMU linux/amd64 emulation, while smaller
# indices (bookworm-updates/security) and any HTTPS fetch succeeded. Switch
# the apt source to the Aliyun mirror over HTTPS, which is both reliable here
# and consistent with this project's China-mainland/Aliyun deployment target.
RUN sed -i \
      -e 's|http://deb.debian.org/debian|https://mirrors.aliyun.com/debian|g' \
      -e 's|http://deb.debian.org/debian-security|https://mirrors.aliyun.com/debian-security|g' \
      /etc/apt/sources.list.d/debian.sources \
  # Bootstrap problem: HTTPS to the mirror needs ca-certificates, which itself
  # would normally come from that same HTTPS source. Temporarily disable cert
  # verification for this one-shot probe image (fetching only public Debian
  # packages), then re-enable default apt behavior implicitly once
  # ca-certificates is installed (no persisted config changes).
  && apt-get -o Acquire::https::Verify-Peer=false -o Acquire::https::Verify-Host=false update \
  && apt-get -o Acquire::https::Verify-Peer=false -o Acquire::https::Verify-Host=false install -y --no-install-recommends \
    ca-certificates curl python3 python3-venv \
    libgtk-3-0 libglu1-mesa libgl1 libglx-mesa0 libwx-perl \
    libwxgtk3.2-1 libwxgtk-gl3.2-1 libsecret-1-0 libudev1 \
    libssl3 wget xz-utils bzip2 \
  && rm -rf /var/lib/apt/lists/*

# uv: fast Python package manager, installed per project convention
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /work
COPY generate_sample.py minimal_print.ini ./
RUN uv venv .venv \
  && . .venv/bin/activate \
  && uv pip install trimesh numpy

# PrusaSlicer: no Debian package for bookworm. Newer releases (2.8.0+) only
# publish AppImage on GitHub, and their AppImage ELF stub sets a non-standard
# e_ident[EI_ABIVERSION], which glibc 2.36 (bookworm) refuses to exec
# ("ELF file ABI version invalid") under this host's linux/amd64 emulation —
# confirmed by direct `ld-linux-x86-64.so.2 <appimage>` invocation. 2.7.4 is
# the newest release that still published a plain .tar.bz2 Linux archive,
# which sidesteps the AppImage runtime entirely (executability probe only).
ARG PRUSASLICER_VERSION=2.7.4
ARG PRUSASLICER_ASSET=PrusaSlicer-2.7.4+linux-x64-GTK3-202404050928.tar.bz2
RUN wget -q -O /tmp/prusaslicer.tar.bz2 \
    "https://github.com/prusa3d/PrusaSlicer/releases/download/version_${PRUSASLICER_VERSION}/${PRUSASLICER_ASSET}" \
  && mkdir -p /opt/prusaslicer \
  && tar -xjf /tmp/prusaslicer.tar.bz2 -C /opt/prusaslicer --strip-components=1 \
  && ln -s /opt/prusaslicer/bin/prusa-slicer /usr/local/bin/prusa-slicer \
  && rm /tmp/prusaslicer.tar.bz2

CMD ["bash"]
