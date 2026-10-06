import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import type { OwnerTransitionArchive } from '../../src/lib/api/trainer2/owner-transition';

/** Private directory must already exist; never publish personal attribution in Git. */
export function publishAttribution(directory: string, archive: OwnerTransitionArchive, sourceCommit: string) {
  if (process.platform !== 'win32' || !/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error('PRIVATE_MANIFEST_PLATFORM_OR_SOURCE');
  const folder = realpathSync(directory);
  const repo = realpathSync(resolve('..'));
  if (folder.toLowerCase().startsWith(repo.toLowerCase())) throw new Error('MANIFEST_MUST_BE_OUTSIDE_REPOSITORY');
  // Verify the existing ACL before writing. Only this operator and SYSTEM may read.
  const command = '$ErrorActionPreference="Stop"; $a=Get-Acl -LiteralPath $env:TRAINER2_MANIFEST_CHECK; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; if(!$a.AreAccessRulesProtected){exit 1}; foreach($r in $a.Access){$s=$r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value; if($r.AccessControlType -eq "Allow" -and $s -ne $sid -and $s -ne "S-1-5-18"){exit 2}}';
  const acl = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
    { env: { ...process.env, PSModulePath: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules'), TRAINER2_MANIFEST_CHECK: folder }, windowsHide: true, stdio: 'ignore' });
  if (acl.status !== 0) throw new Error('PRIVATE_MANIFEST_ACL_REQUIRED');
  const operationId = randomUUID();
  const text = JSON.stringify({ operationId, sourceCommit, recordedAt: new Date().toISOString(), disposition: 'precommit-attribution', ...archive });
  const temporary = join(folder, operationId + '.pending');
  const path = join(folder, operationId + '.json');
  const fd = openSync(temporary, 'wx');
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, path);
  // A separate process must read exactly the durably flushed bytes.
  const check = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("node:fs").readFileSync(process.argv[1]))', path], { windowsHide: true, encoding: 'utf8' });
  if (check.status !== 0 || check.stdout !== text || readFileSync(path, 'utf8') !== text) throw new Error('PRIVATE_MANIFEST_READBACK_FAILED');
  return { operationId, checksum: createHash('sha256').update(text).digest('hex'), sessionCount: archive.sessions.length };
}
