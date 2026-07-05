/**
 * Build the hermetic e2e fixture store: the committed sg-0002 case JSON.
 * (C7 adds a generated wav for the audio-playback specs — wavs are
 * gitignored, so e2e must synthesize its own.)
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixture = fileURLToPath(new URL("./.fixture", import.meta.url));

rmSync(fixture, { recursive: true, force: true });
mkdirSync(`${fixture}/_out`, { recursive: true });
cpSync(`${repoRoot}/data/cases/_out/sg-0002.json`, `${fixture}/_out/sg-0002.json`);

console.log(`e2e fixture store ready at ${fixture}`);
