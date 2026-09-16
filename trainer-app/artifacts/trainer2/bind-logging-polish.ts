import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verificationSource } from '../../scripts/trainer2/verification-source';
const dir = 'artifacts/trainer2/polish-evidence/';
const final = verificationSource();
const browser = JSON.parse(readFileSync(dir + 'browser.json', 'utf8'));
const demo = JSON.parse(readFileSync(dir + 'demo-final.json', 'utf8'));
const deltas = (source: typeof final) => {
  const before = new Map(source.files.map(f => [f.path, f.lfNormalizedSha256]));
  return final.files.filter(f => f.path.startsWith('trainer-app/src/') && before.get(f.path) !== f.lfNormalizedSha256).map(f => f.path);
};
const hashes = readdirSync(dir).filter(name => name !== 'FINAL_BINDING.json').sort().map(name => ({ name, sha256: createHash('sha256').update(readFileSync(dir + name)).digest('hex') }));
writeFileSync(dir + 'FINAL_BINDING.json', JSON.stringify({ recordedAt: new Date().toISOString(),
  base: { commit: '9f9d3587aa60c0364a48489b7ae9015c5e219c42', tree: 'ccc2dd73856da0f42ed1a16c466a3add5745c38e', parent: 'e84f9a5ed7f53e6db62f95622798820b13f1ae5c', cleanBeforeEditing: true },
  final, runtimeChangesAfterDeepJourney: deltas(browser.sourceAfter), runtimeChangesAfterDemoSmoke: deltas(demo.source),
  evidenceHashes: hashes, demo: { url: demo.url, container: 'trainer2-draft-25c70d6fbab2', appPort: 32470, postgresPort: 57796, launcherSession: 72037 },
  cleanup: { verificationContainer: 'trainer2-draft-c13cc2724b77', verificationAppPort: 37250, removed: true, preservedPriorDemoPorts: [37847,33947,37020] },
  qualification: 'Local implementation verification only. No independent acceptance, deployment readiness or real-training authorization.'
}, null, 2));
console.log(JSON.stringify({ commit: final.commit, tree: final.tree, dirtyState: final.dirtyState, runtimeChangesAfterDeepJourney: deltas(browser.sourceAfter), runtimeChangesAfterDemoSmoke: deltas(demo.source) }, null, 2));
