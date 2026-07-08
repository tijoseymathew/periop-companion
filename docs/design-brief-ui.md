# PeriOp Companion — UI Design Brief

**Audience:** external/design team. **Purpose:** high-level requirements for the product's user interface, written so no prior knowledge of the project is assumed. This is a brief, not a spec — it describes what the interface must do and the constraints it must respect; screen-by-screen visual design is the design team's job.

---

## 1. What this product is

PeriOp Companion is a documentation tool for anesthesia providers (anesthetists/anesthesiologists and the nurses who work with them) in a hospital. A patient having surgery is cared for by **different providers at different points**: one doctor sees the patient beforehand (pre-op), a possibly different doctor is with them during surgery (intra-op), and a possibly different provider cares for them in the recovery room afterward (post-op/PACU — post-anesthesia care unit). These providers often never speak to each other directly. What passes between them is documentation.

Today that documentation is manually written, under time pressure, and hard to verify — a doctor reading a note has no way to check "is this actually what the patient told them, or what the record said, or did someone just infer this?" This product listens to (or reads) the actual inputs — prior medical records, a recorded conversation with the patient, spoken notes during surgery — and assembles the required clinical notes automatically, with **every single sentence traceable back to exactly where it came from**: a specific paragraph in a document, or a specific few seconds of a specific recording.

The interface's entire job is to make that traceability tangible and to guide a provider through a multi-step clinical workflow so simply that it requires no training.

This is a demonstration/reference product using synthetic (fake) patient data — no real patients, no real hospital deployment. That does not reduce the interface requirements; it means the design should read as a credible clinical tool, not a toy.

---

## 2. Who uses this, and how

Three provider roles use the same tool at different points in one patient's journey, plus one shared browsing experience:

| Role | When they use it | What they're doing |
|---|---|---|
| **Pre-op provider** | Days before surgery, in clinic | Opens a case, supplies the patient's prior records, records or uploads an interview with the patient, reviews and approves questions the system raises about gaps in the record, reviews the generated note, signs off |
| **Intra-op provider** (the anesthetist in the operating theatre) | During surgery | Has typically never met this patient. Opens the case and needs to get oriented fast — what's already known, what's unresolved. Speaks short voice memos during the case instead of writing anything down. Reviews the generated record afterward and signs off |
| **Post-op / recovery provider** | In the recovery room | Receives a handoff note summarizing everything before and during surgery. This is the single highest-stakes document in the whole product — a provider who never met the patient is being handed responsibility for them. Can play the exact audio clip behind any claim in the handoff. Explicitly acknowledges receiving it |
| **Anyone reviewing a case** | Any time | Browses any case's full history — every note, organized as individually-sourced statements, each clickable to reveal or play its source |

There is no patient-facing surface at all. There is no login system — a lightweight name/role picker is enough to record "who did this," it is not a security feature.

A critical constraint on all three roles: **these are busy clinicians, often not tech-savvy, with zero patience for learning a new tool.** See §5.

---

## 3. The core concept the design must communicate: provenance

This is the single most important idea to get right, visually and interactively, because it's the entire value proposition.

- Every generated note is not free-flowing prose — it's a list of **individual statements** ("claims"), each one a short sentence a clinician would recognize as a normal part of a medical note (e.g., "Aspirin was discontinued 6 days prior to surgery").
- Every statement carries a visible link to where it came from — either:
  - a highlighted excerpt in a source document (an old GP letter, a medication list, a prior anesthetic record), or
  - a short, playable clip of an actual audio recording (with a speaker label and timestamp), or
  - both.
- Clicking a statement (or its source link) surfaces that exact source: it scrolls to and highlights the document excerpt, or it plays the audio starting at the exact right moment and automatically stops when the relevant bit ends.
- The reverse direction matters too: looking at a source document or a transcript, a provider can see "this piece of text/audio was used to support N different statements" — this is how contradictions get surfaced (e.g., the paper record says one thing, the patient said another — both statements exist, both are shown, neither is silently hidden).
- Every statement carries a **verification status** — think of it as a traffic-light-plus system:
  - ✓ **Supported** — the source clearly backs this statement up
  - ⚠ **Unsupported** — cited, but the source doesn't actually establish this
  - ✕ **Conflicting** — two sources disagree
  - → **Inference** — reasonably inferred, not stated outright
  - ○ **Unverified** — not yet checked
  - A statement whose source link is broken/missing shows an unmissable "unresolved" flag — this must never be hidden or fail silently.
- **Unsupported and conflicting statements are never hidden by default.** This is a deliberate trust decision: the tool's whole pitch is that it shows its work, including when the work is shaky. Any filtering UI must make this the default, not an edge case.

Design implication: color and iconography for these five states need to be immediately scannable and consistent everywhere they appear (a running note, a summary list, a filter control). This is closer to an air-traffic or clinical-alarm visual vocabulary than a typical SaaS status-pill vocabulary — legibility and speed of recognition matter more than subtlety.

---

## 4. What the interface needs to do (functional requirements)

### 4.1 A worklist (home / landing view)
The default view is a list of cases (patients), not a single case. A busy clinical unit runs many patients through different stages simultaneously, so this needs to answer "what needs my attention" at a glance:
- Case identifier/label, current stage (pre-op / intra-op / post-op), plain-language status (e.g., "Intra-op — awaiting review"), who last worked on it, and a visible flag if it contains an unresolved conflict.
- Filterable by stage and status.
- This list must scale to a busy department's worth of concurrent cases — design for dozens of rows, not three.

### 4.2 Starting a case (intake)
- A provider starts a case with a label and then supplies the patient's prior records — either pasting text into labeled slots (e.g. "GP summary," "medication list," "prior anesthetic record") or uploading files — plus the surgical plan.
- Once records exist, the system automatically raises a short list of clarifying questions about gaps it found (missing info, stale info, conflicting info), each one linked back to the exact bit of the record that triggered it.
- The provider reviews this list before going to interview the patient: they can dismiss a question, edit its wording, or add one of their own, then approve the final list.

### 4.3 Recording audio (three places this happens: pre-op interview, intra-op voice memos, post-op interview)
- One big, unmistakable record button. Elapsed-time display while recording. Stop button. Option to upload an audio file instead of recording live.
- Intra-op is different in kind: instead of one long recording, the provider records many short voice memos over the course of the case (push-to-talk style), which accumulate into one running timeline.
- This needs to work believably on a tablet at arm's length in an operating theatre — assume the person interacting with it is not standing close to the screen and may have limited attention to spare.

### 4.4 Generating a note (a wait state that needs real design attention)
- After inputs exist, a provider taps one clear "Generate [the pre-op note / the intra-op record / the handoff]" action.
- Generation is **not instant — it can take several minutes** (this is a real AI processing step, not a page load). The interface must show real progress (which stage of processing is happening now), not a bare spinner, and must make it obviously safe to navigate away and come back later without losing anything.

### 4.5 Reviewing a note — the claim ledger (the centerpiece)
- Every generated note renders as an ordered list of individual statements (§3), each with its status badge and its source link(s) — not as a paragraph of prose. This is a deliberate departure from a typical "document" reading experience: think structured list/ledger, not word-processor page.
- Alongside it, a persistent panel shows: an audio player (for whichever recording is currently relevant), and a browsable view of the case's source documents and transcripts.
- Clicking any statement updates that side panel: scrolls/highlights the right document excerpt, or cues up and plays the right audio moment.
- A structured, timestamped list of intra-op events (drug doses, timings, notable occurrences) needs its own tabular view, with the same click-to-source behavior per row.
- A way to export/copy a note as clean readable text (for pasting elsewhere) is required.

### 4.6 Orientation view (for the provider taking over mid-case)
- When a new provider (who has never seen this patient) opens an in-progress case, they land on a purpose-built "catch me up" screen: the prior stage's note, with anything unresolved or conflicting pinned to the very top. This is explicitly the "what do I need to know before I touch this patient" screen — it should read as urgent-but-calm reference material, not a wall of text.

### 4.7 Sign-off
- Completing a stage requires an explicit, named sign-off action. The sign-off screen must surface (not bury) a count of any unsupported/conflicting statements and any unresolved source links before the provider confirms — this is a deliberate "are you sure you've seen this" checkpoint, not a formality.
- A signed-off stage becomes read-only; there's a separate, clearly-labeled "reopen" action if it needs revisiting (this should feel deliberately harder to reach than sign-off itself, but never hidden).

### 4.8 Handoff acknowledge
- The post-op handoff is the highest-stakes screen in the product — it is one provider certifying, in effect, "I have received and understood the care of this patient from someone I may never speak to." The receiving provider must be able to review every statement's source (playing clips as needed) and then take an explicit "Acknowledge" action, timestamped and attributed. Design this screen with the gravity that action deserves — it should not look like a generic "mark as read."

### 4.9 One primary action, always
- At every point in this workflow, exactly one button should read as "the thing to press next," and everything else should be visually quieter. A provider who only ever presses the one obvious button should be able to complete the entire process correctly without reading instructions. This is a testable requirement, not a nice-to-have — design reviews should be able to point at any screen and name its one primary action.

---

## 5. Design principles (hard requirements, not preferences)

These come directly from the clinical context and are non-negotiable:

1. **Zero training required.** Every screen opens with one short plain sentence explaining what's happening and what to do ("Interview recorded. Generate the pre-op note when ready.") No empty states without an instruction. No instruction longer than a sentence.
2. **Clinical vocabulary, not tech vocabulary.** Use terms clinicians already know — "pre-op evaluation," "PACU handoff," "sign off." Avoid presenting internal engineering terms as the primary label for anything (the exception is the word "claim" itself, which is fine to keep in the review/ledger screens, since that audience is specifically reviewing sourcing).
3. **Legible at arm's length.** Minimum comfortable tap-target size, text labels on every action (never icon-only), the record button in particular must be unmissable. Assume some users are viewing this on a tablet from a slight distance, possibly with reading glasses, possibly gloved.
4. **Speech first, typing last.** The only thing a provider is ever required to type is a short case label. Everything else is either pasted/uploaded or spoken. Design should reflect and reinforce this — recording controls are more prominent than any text field.
5. **Nothing to configure.** No settings screen, no preferences, no customizable templates. If a feature needs an explanation to use, treat that as a signal to simplify or cut it, not to add a tooltip.
6. **Errors always say what to do next**, not just that something failed (e.g., "Recording failed to upload — it's saved on this device, tap Retry" rather than a bare error message).
7. **Designed for the least tech-comfortable user in the room** — including senior clinicians who have not adopted new software in years. When in doubt, favor the more obvious, more literal, less clever interaction.
8. **Read-only note content, always.** Providers can filter, click, flag, and sign off — they can never free-type edits into a generated note. There is no rich-text editor anywhere in this product; don't design one.

---

## 6. Visual tone

- Should read as a credible clinical/professional tool — calm, quiet, high-legibility — not a consumer app and not a flashy AI-demo aesthetic.
- A dark-first theme is the current direction, with a restrained neutral (slate/gray) background palette and a single accent color reserved for interactive elements (currently teal). Color should otherwise be reserved almost entirely for the verification-status system in §3 — that's the one place saturated color earns its keep.
- Monospace type is used for identifiers, timestamps, and transcript text (to visually distinguish "raw sourced material" from generated prose); a plain UI typeface elsewhere.
- No proprietary/borrowed brand assets of any kind — this product must not visually resemble or borrow color/iconography from any specific vendor's existing product or brand (a generic, neutral clinical icon set is expected — plain line icons, no invented mascot or logo system).
- A light theme is a nice-to-have, not required for MVP.

---

## 7. Explicitly out of scope

To keep the brief bounded — please do not design for:
- Patient-facing screens of any kind.
- Login/authentication flows (identity is a lightweight "pick your name" affordance only).
- Note/text editing (rich text editor, templates, free-form authoring).
- EHR/medical-records-system integration screens.
- Phone-sized mobile layouts (tablet-width is the smallest target; the primary surface is desktop/tablet).
- Any settings/admin/configuration screens.

---

## 8. What we need back from the design team

- A visual design system: color tokens (including the full 5-state verification-status palette), type scale, spacing, and a component set (buttons, status badges, source-link "chips," list rows, the audio player control, tabbed panels).
- Screen designs for each flow in §4: worklist, case intake, question review, audio recording (both the single-interview and multi-memo variants), the generation/progress state, the claim-ledger review workspace (including its document/transcript/audio side panel), the orientation view, sign-off, and handoff-acknowledge.
- A tablet-width treatment for the intra-op recording screen specifically (§4.3) — this is the one screen most likely to be used away from a desk.
- Guidance on how the "one primary action" rule (§4.9) and the plain-sentence status copy (§5.1) should look across all screens, since these are meant to be consistent everywhere, not screen-specific.

---

## 9. Glossary (terms that will appear in the product)

| Term | Plain meaning |
|---|---|
| Case | One patient's episode of care, from pre-op through recovery |
| Stage | One of the three phases: pre-op, intra-op, post-op |
| Claim | One individual, sourced statement inside a generated note |
| Provenance / source link | The specific document excerpt or audio clip a claim points back to |
| Chunk | A labeled excerpt of a source document (like a paragraph with an ID) |
| Segment | A labeled, timestamped span of a transcript (who said what, and when) |
| Sign off | A provider's explicit confirmation that they've reviewed a stage's output |
| Handoff | The note transferring a patient's care from the operating theatre to the recovery room |
| Acknowledge | The recovery-room provider's confirmation that they've received and reviewed the handoff |
| Gap analysis / clarifying questions | The system's auto-generated list of "things missing or unclear in this patient's record" |
