// Allowlist instead of credential-name heuristics: task tokens, provider keys,
// PG*, database targets, NODE_OPTIONS and unrelated app settings never inherit.
const platformNames = new Set([
  "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP",
  "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "LANG", "LC_ALL", "TZ",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS",
  "HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "SYSTEMDRIVE", "USERDOMAIN", "USERNAME",
]);

export function authWebPlatformEnvironment(inherited: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(inherited).filter(([key]) => platformNames.has(key.toUpperCase())));
}

/** Bootstrap the actual Next process, before Next imports or environment loading.
 * Records key names only; fixtures must run in a checkout without dotenv files. */
export function authWebEnvironmentProbe(keys: string[]): string {
  return `const assert = require('node:assert/strict');
const fs = require('node:fs');
assert.deepEqual(Object.keys(process.env).sort(), ${JSON.stringify(keys.sort())});
for (const file of ['.env', '.env.local', '.env.development', '.env.development.local'])
  assert(!fs.existsSync(file), 'Auth qualification requires a dotenv-free checkout');
for (const [key, role] of Object.entries({
  TRAINER2_IDENTITY_CONNECTION_STRING: 'trainer2_identity_runtime',
  TRAINER2_READ_CONNECTION_STRING: 'trainer2_draft_reader',
  TRAINER2_WRITE_CONNECTION_STRING: 'trainer2_draft_runtime'
})) assert.equal(new URL(process.env[key]).username, role);
console.log('TRAINER2_AUTH_WEB_ENVIRONMENT_VERIFIED ' + JSON.stringify(Object.keys(process.env).sort()));
require(require.resolve('next/dist/bin/next', { paths: [process.cwd()] }));
`;
}
