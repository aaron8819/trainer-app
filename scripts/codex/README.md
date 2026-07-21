# Trainer Codex remote status

`Invoke-TrainerRemoteStatus.ps1` is the single public remote-status command.

## Offline status

```powershell
.\scripts\codex\Invoke-TrainerRemoteStatus.ps1
.\scripts\codex\Invoke-TrainerRemoteStatus.ps1 -Json
```

Offline mode preserves the `trainer-remote-status` version 1 contract. It compares the committed expected identity with local Git linkage only. It does not invoke `gh`, contact any provider, connect to a database, or write repository state.

## Authenticated GitHub status

```powershell
.\scripts\codex\Invoke-TrainerRemoteStatus.ps1 -GitHub
.\scripts\codex\Invoke-TrainerRemoteStatus.ps1 -GitHub -Json
.\scripts\codex\Invoke-TrainerRemoteStatus.ps1 -GitHub -Branch codex/example
```

The GitHub scope performs authenticated read-only status collection after expected repository identity validation. It does not log in, push, create or modify pull requests, rerun checks, trigger workflows, alter settings, or deploy.

The expected owner, repository, and default branch come only from `trainer-remote.v1.json`. If any of those values is missing or unsafe, the command returns a blocked version 1 report before `gh` discovery, authentication, or network access. Otherwise, it requires an existing active `gh` authentication for `github.com`, resolves the authenticated login through the API, and stops before broader reads unless the account and immutable repository response match the committed expected identity exactly. It never logs in, switches accounts, prints tokens, reads credential files, or reports authentication headers.

After the identity gate, the command reads:

- repository numeric and GraphQL node IDs, visibility, and default branch;
- live default-branch SHA and containment of the locally inspected commit; a GitHub `404` for a local-only commit is reported as `not-remotely-addressable` without implying identity or ancestry corruption;
- requested branch existence, SHA, and divergence when present;
- pull-request state, draft state, mergeability, review decision, and paginated unresolved review threads;
- status contexts, check runs, committed Actions workflow inventory, and required checks only when protection configuration can be resolved;
- classic branch protection and repository ruleset availability permitted by the authenticated account;
- GitHub deployment records and their latest statuses for the inspected commit.

Unknown permissions and partial API results remain explicit. The command does not claim that required checks passed unless required-check configuration was resolved. No workflows is reported separately from workflows present with checks not yet run. GitHub deployment records are repository metadata; they are not proof of the active Vercel production alias or deployment.

The GitHub provider uses only registered `gh auth status`, explicit REST `GET`, and GraphQL `query` shapes. It does not run `git fetch`, `pull`, `push`, `merge`, or branch creation from inside the status command.

## Authenticated Vercel deployment status

```powershell
$env:VERCEL_TOKEN = Read-Host "Vercel token" -MaskInput
.\scripts\codex\Invoke-TrainerRemoteStatus.ps1 -Deployment
.\scripts\codex\Invoke-TrainerRemoteStatus.ps1 -Deployment -Json
Remove-Item Env:VERCEL_TOKEN
```

The committed production identity is the Vercel team `team_YPrwp64VBrZbh9mEcwGQV8D4` / `aaron8819s-projects`, project `prj_XtOD3yvnH76X62LEDKi2qKV7XFaj` / `trainer-app`, and production alias `trainer-app-indol.vercel.app`. These are expected non-secret identifiers. Observed provider identity is reported separately.

Before reading `VERCEL_TOKEN`, the public command requires all five values to be present and strictly valid. A missing, malformed, unsafe, redacted, or URL-bearing value returns a blocked version 1 report with `networkAccessed: false`, null live deployment evidence, and zero provider calls. If process-scoped `VERCEL_TOKEN` is absent, the command returns the same no-network blocked shape with a precise manual prerequisite and does not prompt. The operator sets and removes the variable; the script never persists, prints, fingerprints, creates, rotates, or removes the token.

The provider uses built-in PowerShell HTTPS against the official `https://api.vercel.com` REST API. It needs no package installation, global CLI, administrator rights, project link, or Vercel CLI authentication state. A single internal dispatcher accepts only registry IDs, builds URLs internally, permits only `GET` on `api.vercel.com`, refuses redirects, sends the bearer token only in the `Authorization` header, requires JSON, applies a finite timeout, and reports fixed sanitized failures without request headers or raw response bodies.

After exact team ID/slug and project ID/name validation, the provider resolves the configured production alias to one production deployment and verifies that it belongs to the expected project and active production target. It reports sanitized deployment identity, state, target, timestamps, Git metadata, creator identity when available, local/default-SHA comparisons, and a previous successful production deployment as a **rollback candidate**. Schema compatibility remains `unknown` unless proven separately; the report never labels a candidate safe to roll back.

GitHub deployment records and status contexts are repository control-plane evidence, not active Vercel production truth. When `-GitHub -Deployment` are requested together, commit metadata may classify a pending Vercel context as corresponding to active production, stale for a ready active deployment, or associated with a different commit/preview. A Vercel rollback changes production deployment routing; a Git revert creates source history and is a separate action.

The Deployment scope performs authenticated Vercel read-only REST collection after exact team, project, and production-alias identity validation. It does not log in, link projects, deploy, promote, rollback, change aliases or domains, inspect unrelated environment variables, or modify Vercel configuration. Never paste the token into chat, Git configuration, a committed `.env` file, or a command argument.

Unavailable permissions, provider failures, ambiguous alias resolution, and unknown facts fail closed or remain explicitly unavailable. Local `.vercel/project.json` filename presence is non-authoritative evidence; ignored linkage contents are never read.

## Exit codes

- `0`: the requested reads completed without blockers.
- `1`: a valid report contains authentication, identity, access, required-fact, or integration-status blockers.
- `2`: the invocation or provider-scope combination is invalid.
- `3`: policy loading or unexpected execution failed.

A failing check rollup is an integration blocker in a valid report and exits `1`; it is not a tooling execution failure. Authentication or identity blockers are reported without remediation.

Supabase authenticated reads, a full cross-system traceability verdict, and every remote write remain later, separately authorized phases.
