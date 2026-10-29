const EQUALS_FORMS = ['--user-data-dir=', '/user-data-dir='];
const BARE_FORMS = ['--user-data-dir', '/user-data-dir'];

/**
 * The `--user-data-dir` Electron/Chromium switch, if the caller passed one.
 * Accepts `--user-data-dir=<path>`, the Windows `/user-data-dir=<path>` form,
 * and the space-separated `--user-data-dir <path>`.
 */
export function explicitUserDataDir(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    for (const form of EQUALS_FORMS) {
      if (arg.startsWith(form)) {
        const value = arg.slice(form.length).trim();
        if (value) return value;
      }
    }
    if (BARE_FORMS.includes(arg)) {
      const value = argv[i + 1]?.trim();
      if (value && !value.startsWith('-')) return value;
    }
  }
  return null;
}

/**
 * Where Electron should keep userData. A command-line switch always wins: it is a
 * per-invocation choice (several windows on one box, each with its own profile),
 * while GOOSE_USER_DATA_DIR is per-user and would otherwise redirect every launch
 * on the machine to one directory. Returns null to keep Electron's default.
 */
export function resolveUserDataDir(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const fromArgv = explicitUserDataDir(argv);
  if (fromArgv) return fromArgv;
  const fromEnv = env.GOOSE_USER_DATA_DIR?.trim();
  return fromEnv ? fromEnv : null;
}
