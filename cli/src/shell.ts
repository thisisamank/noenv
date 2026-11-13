export type Shell = "zsh" | "bash";

const FIND_ROOT = `_noenv_root() {
  local dir="$PWD"
  until [[ -e "$dir/.git" || "$dir" == "/" ]]; do dir="\${dir%/*}"; dir="\${dir:-/}"; done
  if [[ -e "$dir/.git" ]]; then REPLY="$dir"; else REPLY=""; fi
}
`;

const HOOKS: Record<Shell, string> = {
  zsh: `${FIND_ROOT}_noenv_hook() {
  local revision="" REPLY
  _noenv_root
  [[ -n "$_NOENV_REV_FILE" && -r "$_NOENV_REV_FILE" ]] && revision="$(<"$_NOENV_REV_FILE")"
  if [[ "$REPLY" != "$_NOENV_ROOT" || -n "$_NOENV_RETRY" || "$revision" != "$_NOENV_REV" ]]; then
    _NOENV_ROOT="$REPLY"
    if [[ -z "$REPLY" && ( -n "$_NOENV_RESTORE" || -z "$_NOENV_STATE" ) ]]; then
      eval "$_NOENV_RESTORE"
    else
      eval "$(printf '%s' "$_NOENV_STATE" | command noenv hook-env zsh)"
    fi
  fi
}
_noenv_refresh() {
  local fd
  exec {fd}< <(command noenv refresh "$@" 2>/dev/null; print)
  zle -F -w "$fd" _noenv_ready 2>/dev/null || exec {fd}<&-
}
_noenv_ready() {
  local fd="$1"
  zle -F "$fd"
  exec {fd}<&-
  zle -I
  _noenv_hook
  zle reset-prompt
}
zle -N _noenv_ready 2>/dev/null
typeset -ag precmd_functions chpwd_functions
if (( ! \${precmd_functions[(I)_noenv_hook]} )); then precmd_functions=(_noenv_hook $precmd_functions); fi
if (( ! \${chpwd_functions[(I)_noenv_hook]} )); then chpwd_functions=(_noenv_hook $chpwd_functions); fi
`,
  bash: `${FIND_ROOT}_noenv_hook() {
  local previous_exit=$? revision="" REPLY
  _noenv_root
  [[ -n "$_NOENV_REV_FILE" && -r "$_NOENV_REV_FILE" ]] && revision="$(<"$_NOENV_REV_FILE")"
  if [[ "$REPLY" != "$_NOENV_ROOT" || -n "$_NOENV_RETRY" || "$revision" != "$_NOENV_REV" ]]; then
    _NOENV_ROOT="$REPLY"
    if [[ -z "$REPLY" && ( -n "$_NOENV_RESTORE" || -z "$_NOENV_STATE" ) ]]; then
      eval "$_NOENV_RESTORE"
    else
      eval "$(printf '%s' "$_NOENV_STATE" | command noenv hook-env bash)"
    fi
  fi
  return $previous_exit
}
_noenv_refresh() {
  (command noenv refresh "$@" >/dev/null 2>&1 &)
}
if [[ ";\${PROMPT_COMMAND:-};" != *";_noenv_hook;"* ]]; then
  PROMPT_COMMAND="_noenv_hook\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
fi
`,
};

export function parseShell(value: string | undefined): Shell {
  if (value !== "zsh" && value !== "bash") {
    throw new Error("shell must be zsh or bash");
  }
  return value;
}

export function hookScript(shell: Shell): string {
  return HOOKS[shell];
}

export function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function exportLine(name: string, value: string): string {
  return `export ${name}=${quote(value)}`;
}

export function setLine(name: string, value: string): string {
  return `${name}=${quote(value)}`;
}

export function unsetLine(name: string): string {
  return `unset ${name}`;
}
