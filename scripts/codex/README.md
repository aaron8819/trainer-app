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

## Exit codes

- `0`: the requested reads completed without blockers.
- `1`: a valid report contains authentication, identity, access, required-fact, or integration-status blockers.
- `2`: the invocation or provider-scope combination is invalid.
- `3`: policy loading or unexpected execution failed.

A failing check rollup is an integration blocker in a valid report and exits `1`; it is not a tooling execution failure. Authentication or identity blockers are reported without remediation.

Vercel and Supabase authenticated reads, cross-system traceability, and every remote write remain later, separately authorized phases.
