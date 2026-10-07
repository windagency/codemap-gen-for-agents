#!/usr/bin/env bash
# Installs every pinned CLI tool this repo's hooks, scripts, and docs call for.
# Each download is checked against a SHA-256 pinned here, per architecture.
# To bump a tool: change its version and both hashes on the same line.
set -euo pipefail

arch="$(dpkg --print-architecture)"
case "$arch" in
amd64 | arm64) ;;
*)
	echo "Unsupported architecture: $arch" >&2
	exit 1
	;;
esac

# name  url-template ({V} = version, {A} = asset suffix)  amd64-sha256  arm64-sha256  version  amd64-suffix  arm64-suffix
tools=$(
	cat <<'EOF'
gitleaks https://github.com/gitleaks/gitleaks/releases/download/v{V}/gitleaks_{V}_linux_{A}.tar.gz 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080 8.30.1 x64 arm64
gh https://github.com/cli/cli/releases/download/v{V}/gh_{V}_linux_{A}.tar.gz bb766f710eef8ede859c18578c72c327597cd4c8a85b06001b1f3843c6019386 7862c86c72f43df3a2d93ddde6f473285b4e2af61b494849846827e513ef6484 2.102.0 amd64 arm64
rg https://github.com/BurntSushi/ripgrep/releases/download/{V}/ripgrep-{V}-{A}.tar.gz 33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c a740b91c82eaf9914cfedd353572f2791cbe0162c84101ee0951058f4dcbc90d 15.2.0 x86_64-unknown-linux-musl aarch64-unknown-linux-gnu
fd https://github.com/sharkdp/fd/releases/download/v{V}/fd-v{V}-{A}.tar.gz 761c72dc8e120d85b22292063be8a796e2eeb20eb3e4f38b8fa2343ccf3514a7 d76c4317f7d5dba69f8a2a15856c90c777e7f0dd4e85f0de8c76de6992c374d4 10.5.0 x86_64-unknown-linux-musl aarch64-unknown-linux-musl
yq https://github.com/mikefarah/yq/releases/download/v{V}/yq_linux_{A} 8e34fc298390875de416e6a4afcb8cabeceb25d9aa8506c1a2f9353cf702ea5f 189088da0c6429ec5178dfaab1a114805f6cab0b61b165ab236efedf1d57a71b 4.54.1 amd64 arm64
eza https://github.com/eza-community/eza/releases/download/v{V}/eza_{A}.tar.gz e06eebab74b73d6b7d51a796a353824b001bea82df077706382e100815d28904 40b87ae8628aa2ff0f0d2dc24ab52f689631366385c3da630bae745671fd71ec 0.23.5 x86_64-unknown-linux-musl aarch64-unknown-linux-gnu
fzf https://github.com/junegunn/fzf/releases/download/v{V}/fzf-{V}-linux_{A}.tar.gz 05e6813a337cc722c3ed07e54a764b75cc5d671e2e60459db0ba696ee5fa7504 5d673b849f494f0d64ec471d8640b153ca8849e3846a31da17abdcfce8df6b46 0.74.4 amd64 arm64
zoxide https://github.com/ajeetdsouza/zoxide/releases/download/v{V}/zoxide-{V}-{A}.tar.gz 2d93385b99f3e82cf2701609a1bffcad863fbeb75aa3fe7eb6be4d29be68b1ae f1f16c5d6298d63dee467eedea1cdcd8490e43e493bea43acd416dc9033ef641 0.10.0 x86_64-unknown-linux-musl aarch64-unknown-linux-musl
lazygit https://github.com/jesseduffield/lazygit/releases/download/v{V}/lazygit_{V}_linux_{A}.tar.gz 5b45541155d20bd32bf2cc5ab5b7e3d91c2eebf0fb1242281350edc27d59d2b7 9a4fc4656897ac9f7877b835473ce1a75620cc267f554c57fc4ff266407f3257 0.66.0 x86_64 arm64
jq https://github.com/jqlang/jq/releases/download/jq-{V}/jq-linux-{A} b1c22172dd303f3be49e935aa56aa48a8b7a46e0bc838b4997d3bb451495870f 8b85c817833814ddca00a144c33705546355afccf0cf39b188f3cdb48b852309 1.8.2 amd64 arm64
EOF
)

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

while read -r name template sha_amd64 sha_arm64 version asset_amd64 asset_arm64; do
	if [ "$arch" = amd64 ]; then
		sha="$sha_amd64" asset="$asset_amd64"
	else
		sha="$sha_arm64" asset="$asset_arm64"
	fi
	url="${template//\{V\}/$version}"
	url="${url//\{A\}/$asset}"
	file="$work/$name.download"

	curl -fsSL --retry 3 -o "$file" "$url"
	echo "$sha  $file" | sha256sum -c --quiet -

	case "$url" in
	*.tar.gz)
		mkdir "$work/$name"
		tar -xzf "$file" -C "$work/$name"
		install -m 0755 "$(find "$work/$name" -type f -name "$name" | head -n 1)" "/usr/local/bin/$name"
		;;
	*) install -m 0755 "$file" "/usr/local/bin/$name" ;;
	esac
	echo "installed $name $version"
done <<<"$tools"
