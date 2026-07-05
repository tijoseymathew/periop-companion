import { describe, expect, it } from "vitest";
import { makeCase } from "../../test/fixtures";
import { artifactToMarkdown } from "../markdown";

const kase = makeCase();

describe("artifactToMarkdown", () => {
  it("renders claims as a bulleted note with status glyphs and citation footnotes", () => {
    const md = artifactToMarkdown(kase, kase.artifacts[0]);
    expect(md).toContain("# note:pre-anesthesia-eval");
    expect(md).toContain("- ✓ Aspirin was discontinued 6 days prior to surgery. [^1]");
    expect(md).toContain("- ✗ Records list aspirin 100mg daily as current. [^2][^1]");
    // footnotes carry the exact cited span
    expect(md).toContain('[^1]: `audio:preop-interview#s017` — PATIENT, 214.3–221.8s: "I stopped the aspirin last Tuesday."');
    expect(md).toContain('[^2]: `doc:gp-summary#c001` — [Medications] "On aspirin 100mg daily."');
  });

  it("reuses one footnote per ref across claims", () => {
    const md = artifactToMarkdown(kase, kase.artifacts[0]);
    // s017 is cited by two claims but footnoted once
    expect(md.match(/\[\^1\]: /g)).toHaveLength(1);
  });

  it("marks unresolvable refs UNRESOLVED in the footnotes", () => {
    const md = artifactToMarkdown(kase, kase.artifacts[3]);
    expect(md).toContain("`doc:gone#c9` — UNRESOLVED");
  });

  it("renders claims without citations as plain bullets", () => {
    const md = artifactToMarkdown(kase, kase.artifacts[1]);
    expect(md).toContain("- · Propofol 120mg given at 08:00.");
    expect(md).not.toContain("[^");
  });
});
