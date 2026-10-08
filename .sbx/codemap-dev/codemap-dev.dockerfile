# One image for both the Docker Sandboxes workload (codemap-dev.yaml beside this file) and .devcontainer/.

# Bootstrap CA bundle for apt over HTTPS. The slim base ships no ca-certificates, and installing them needs apt.
FROM alpine:3.24.2@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6 AS certs

# Node matches package.json's volta pin. The digest is the multi-arch index, so amd64 and arm64 hosts both resolve it.
FROM node:26.9.0-trixie-slim@sha256:3a771f83944bb763050c23c0225c260638c4b7899e7a72485ef75e5e570499e5

# g++/make/python3: node-gyp fallback for the tree-sitter grammars if no prebuild matches.
# openssh-client: ssh-add and ssh-keygen, for SSH commit signing through the forwarded agent.
# socat: sbx relays the host agent over TCP (SSH_AUTH_SOCK_GATEWAY) and uses the image's socat to expose it at SSH_AUTH_SOCK.
# apt uses HTTPS: some networks mangle plain HTTP on port 80. The bootstrap bundle only serves this first install.
COPY --from=certs /etc/ssl/certs/ca-certificates.crt /tmp/bootstrap-ca.crt
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|' /etc/apt/sources.list.d/debian.sources \
	&& apt-get -o Acquire::https::CAInfo=/tmp/bootstrap-ca.crt update \
	&& apt-get -o Acquire::https::CAInfo=/tmp/bootstrap-ca.crt install -y --no-install-recommends ca-certificates curl g++ git less make openssh-client python3 socat \
	&& rm -rf /var/lib/apt/lists/* /tmp/bootstrap-ca.crt

COPY install-tools.sh /tmp/install-tools.sh
RUN bash /tmp/install-tools.sh && rm /tmp/install-tools.sh

# pnpm matches package.json's packageManager pin. Kept beside its dist/ folder, which the binary loads at runtime.
# Symlinked into /usr/local/bin, since Debian's /etc/profile resets PATH in login shells.
ARG PNPM_VERSION=12.4.2
ARG PNPM_SHA256_AMD64=ce1ed690fe9c2f091d7267e1afbe9380abb08bb577e95348fda194a41147d2ec
ARG PNPM_SHA256_ARM64=dc4a29d9848ef005bec3d36d49aae84b115ec3b18c110a3a7f33c37f7fd520bf
RUN arch="$(dpkg --print-architecture)" \
	&& if [ "$arch" = amd64 ]; then asset=x64 sha="$PNPM_SHA256_AMD64"; else asset=arm64 sha="$PNPM_SHA256_ARM64"; fi \
	&& curl -fsSL --retry 3 -o /tmp/pnpm.tar.gz "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-linux-${asset}.tar.gz" \
	&& echo "$sha  /tmp/pnpm.tar.gz" | sha256sum -c --quiet - \
	&& mkdir -p /opt/pnpm \
	&& tar -xzf /tmp/pnpm.tar.gz -C /opt/pnpm \
	&& rm /tmp/pnpm.tar.gz \
	&& ln -s /opt/pnpm/pnpm /usr/local/bin/pnpm

# Docker Sandboxes requires a non-root "agent" user, uid 1000, home /home/agent. The node image's uid-1000 user is renamed.
RUN usermod --login agent --home /home/agent --move-home node \
	&& groupmod --new-name agent node

# Every Bash shell sources /etc/sandbox-persistent.sh: login shells via profile.d, interactive ones via .bashrc,
# non-interactive ones (Git hooks, sbx's launch) via BASH_ENV. It loads the signing fallback and zoxide.
COPY git-signing.sh /usr/local/share/codemap-dev/git-signing.sh
RUN printf '%s\n' '. /usr/local/share/codemap-dev/git-signing.sh' \
		'case $- in *i*) eval "$(zoxide init bash)" ;; esac' > /etc/sandbox-persistent.sh \
	&& printf '%s\n' '. /etc/sandbox-persistent.sh' > /etc/profile.d/sandbox-persistent.sh \
	&& printf '%s\n' '. /etc/sandbox-persistent.sh' >> /home/agent/.bashrc

# Pre-created so the devcontainer's node_modules named volume inherits agent's ownership on first mount.
RUN mkdir -p /workspace/node_modules && chown -R agent:agent /workspace

# The sandbox proxy's CA is added to this bundle at start; Node doesn't read the system store by default.
ENV HOME=/home/agent \
	BASH_ENV=/etc/sandbox-persistent.sh \
	NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

USER agent
WORKDIR /workspace
ENTRYPOINT ["bash", "-l"]
CMD []
