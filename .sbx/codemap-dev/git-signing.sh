# Sourced by every Bash shell in the sandbox or devcontainer, through /etc/sandbox-persistent.sh.
# .git/config is shared with the host through the workspace mount, so its user.signingkey can
# name a host-only path (e.g. /Users/<name>/.ssh/key.pub) that doesn't exist here.
# When it does, sign with a key from the forwarded ssh-agent instead.
# GIT_CONFIG_* env outranks every config file, so .git/config itself stays untouched.
# Set GIT_SIGNING_KEY to a literal "ssh-ed25519 AAAA..." to pick a key other than the agent's first.
__signing_key="$(git config --get user.signingkey 2>/dev/null)"
if [ "$(git config --get gpg.format 2>/dev/null)" = ssh ] \
	&& [ -n "$__signing_key" ] \
	&& [ "${__signing_key#key::}" = "$__signing_key" ] \
	&& [ "${__signing_key#ssh-}" = "$__signing_key" ] \
	&& [ ! -e "$__signing_key" ]; then
	__agent_key="${GIT_SIGNING_KEY:-$(ssh-add -L 2>/dev/null | head -n 1)}"
	case "$__agent_key" in
	ssh-* | ecdsa-* | sk-*)
		export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.signingkey GIT_CONFIG_VALUE_0="key::$__agent_key"
		;;
	*)
		case $- in
		*i*) echo "git-signing: $__signing_key isn't in here and the ssh-agent has no key; commits won't be signed." >&2 ;;
		esac
		;;
	esac
	unset __agent_key
fi
unset __signing_key
