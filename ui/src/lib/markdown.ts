/**
 * Copy-as-Markdown rendering (ui.md §5.3): claims as a bulleted note with
 * one footnote per distinct citation carrying the exact cited span.
 */
import { resolveRef } from "./provenance";
import type { ArtifactRecord, Case, ClaimStatus } from "./schema";

/**
 * Copy-as-text mirrors the CLI renderer's ASCII-ish glyph vocabulary (ui.md
 * §6), kept independent of the on-screen status badge — the badge's icons are
 * a UI design choice, this export stays in lockstep with the CLI/static HTML.
 */
const MD_STATUS_GLYPHS: Record<ClaimStatus, string> = {
  supported: "✓",
  unsupported: "?",
  conflicting: "✗",
  unverified: "·",
  inference: "→",
};

function footnoteBody(kase: Case, ref: string): string {
  const hit = resolveRef(kase, ref);
  if (!hit) return `\`${ref}\` — UNRESOLVED`;
  if (hit.kind === "chunk") {
    const section = hit.chunk.section ? `[${hit.chunk.section}] ` : "";
    return `\`${ref}\` — ${section}"${hit.chunk.text}"`;
  }
  const { speaker, t0, t1, text } = hit.segment;
  return `\`${ref}\` — ${speaker}, ${t0.toFixed(1)}–${t1.toFixed(1)}s: "${text}"`;
}

export function artifactToMarkdown(kase: Case, artifact: ArtifactRecord): string {
  const refs: string[] = [];
  const lines: string[] = [`# ${artifact.artifact_id}`, ""];
  for (const claim of artifact.claims) {
    const notes = claim.provenance
      .map((ref) => {
        let i = refs.indexOf(ref);
        if (i === -1) i = refs.push(ref) - 1;
        return `[^${i + 1}]`;
      })
      .join("");
    lines.push(`- ${MD_STATUS_GLYPHS[claim.status]} ${claim.text}${notes ? ` ${notes}` : ""}`);
  }
  if (refs.length > 0) {
    lines.push("");
    refs.forEach((ref, i) => lines.push(`[^${i + 1}]: ${footnoteBody(kase, ref)}`));
  }
  return lines.join("\n") + "\n";
}

/** Clipboard API with a textarea/execCommand fallback (blueprint pattern). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}
