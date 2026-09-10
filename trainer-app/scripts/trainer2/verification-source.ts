import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function verificationSource() {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
  const root = git("rev-parse", "--show-toplevel");
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8", windowsHide: true })
    .split("\0").filter(Boolean).sort().map(path => {
      const bytes = readFileSync(resolve(root, path));
      const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
      return { path, sha256: hash(bytes), lfNormalizedSha256: hash(bytes.toString("utf8").replaceAll("\r\n", "\n")), bytes: bytes.length };
    });
  return { commit: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}"), dirtyState: git("status", "--porcelain=v1"),
    manifestHash: createHash("sha256").update(JSON.stringify(files)).digest("hex"), files,
    overlay: "none; all regression definitions are in the correction source manifest", lineEndings: "Raw SHA-256 binds checkout bytes; LF-normalized hashes qualify Windows CRLF differences." };
}
