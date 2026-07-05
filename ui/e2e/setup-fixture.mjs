/**
 * Build the hermetic e2e fixture store: the committed sg-0002 case JSON
 * (browse/citation specs, no wav — exercises timestamp-only degradation)
 * plus a tiny synthetic case with a generated wav (audio-playback specs;
 * wavs are gitignored so e2e synthesizes its own).
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixture = fileURLToPath(new URL("./.fixture", import.meta.url));

rmSync(fixture, { recursive: true, force: true });
mkdirSync(`${fixture}/_out`, { recursive: true });
cpSync(`${repoRoot}/data/cases/_out/sg-0002.json`, `${fixture}/_out/sg-0002.json`);

// ---- sg-audio: minimal case whose wav actually exists ----------------------

/** Valid PCM wav: mono, 16-bit, 8 kHz, `seconds` of a soft 440 Hz tone. */
function makeWav(seconds) {
  const rate = 8000;
  const n = rate * seconds;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits/sample
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const sgAudio = {
  case_id: "sg-audio",
  sources: [
    {
      source_id: "audio:preop-interview",
      type: "audio",
      segments: [
        { seg_id: "s000", t0: 0.0, t1: 1.0, speaker: "PROVIDER", text: "Any blood thinners?" },
        { seg_id: "s001", t0: 1.0, t1: 2.0, speaker: "PATIENT", text: "I stopped the aspirin." },
      ],
    },
  ],
  artifacts: [
    {
      artifact_id: "note:pacu-handoff",
      claims: [
        {
          claim_id: "c-001",
          text: "Aspirin was held before surgery.",
          provenance: ["audio:preop-interview#s001"],
          status: "supported",
        },
      ],
    },
  ],
  open_questions: [],
  intraop_events: [],
  anticipated_issues: [],
};

writeFileSync(`${fixture}/_out/sg-audio.json`, JSON.stringify(sgAudio, null, 2));
mkdirSync(`${fixture}/sg-audio/audio`, { recursive: true });
writeFileSync(`${fixture}/sg-audio/audio/preop-interview.wav`, makeWav(4));

console.log(`e2e fixture store ready at ${fixture}`);
