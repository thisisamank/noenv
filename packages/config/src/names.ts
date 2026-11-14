export const IDENTIFIER = /^[A-Za-z0-9_-]+$/;
export const ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const REPO = /^[a-z0-9.-]+(\/[a-z0-9._~-]+)+$/;

const RESERVED_NAMES = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "IFS", "ENV", "BASH_ENV", "CDPATH", "FPATH", "MANPATH", "MAILPATH",
  "PROMPT_COMMAND", "PS0", "PS1", "PS2", "PS3", "PS4", "PROMPT", "PROMPT2", "PROMPT3", "PROMPT4", "RPROMPT", "RPROMPT2", "RPS1", "RPS2",
  "ZDOTDIR", "SHELLOPTS", "BASHOPTS", "GLOBIGNORE", "HISTFILE", "TMOUT", "TERMINFO", "HOSTALIASES", "GCONV_PATH", "RESOLV_HOST_CONF",
  "PRECMD_FUNCTIONS", "PREEXEC_FUNCTIONS", "CHPWD_FUNCTIONS",
  "NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "PYTHONSTARTUP", "PYTHONPATH", "PYTHONHOME", "PYTHONINSPECT",
  "PERL5OPT", "PERL5LIB", "PERLLIB", "RUBYOPT", "RUBYLIB", "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS",
  "EDITOR", "VISUAL", "PAGER", "BROWSER", "LESSOPEN", "LESSCLOSE", "SSH_ASKPASS", "SUDO_ASKPASS", "SSH_AUTH_SOCK",
]);

const RESERVED_PREFIXES = ["LD_", "DYLD_", "GIT_", "BASH_FUNC_", "NOENV_", "_NOENV_", "NPM_CONFIG_"];

export function isReservedName(name: string): boolean {
  const upper = name.toUpperCase();
  return RESERVED_NAMES.has(upper) || RESERVED_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

export function isSecretName(name: string): boolean {
  return ENV_VAR_NAME.test(name) && !isReservedName(name);
}
