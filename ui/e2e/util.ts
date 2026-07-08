import type { APIRequestContext } from "@playwright/test";

/** Valid PCM wav: mono, 16-bit, 16 kHz — accepted without ffmpeg server-side. */
export function makeWav(seconds = 0.2): Buffer {
  const rate = 16000;
  const n = Math.round(rate * seconds);
  const data = Buffer.alloc(n * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * Walk a fresh case through pre-op sign-off via the API (stub runner), so a
 * UI test can start at the intra-op capture screen without re-driving the
 * whole pre-op flow through the browser.
 */
export async function apiWalkToIntraop(
  request: APIRequestContext,
  label: string,
  providerId = "p-lim",
): Promise<string> {
  const created = await request.post("/api/cases", {
    data: { label, provider_id: providerId },
  });
  const caseId = (await created.json()).case_id as string;

  await request.post(`/api/cases/${caseId}/sources/document`, {
    data: {
      doc_type: "gp-summary",
      text: "# GP Summary\n\n## Medications\n\nAspirin 100mg OD, current.",
      provider_id: providerId,
    },
  });
  await request.post(`/api/cases/${caseId}/sources/document`, {
    data: { doc_type: "op-plan", text: "# Op Plan\n\nLaparoscopic chole.", provider_id: providerId },
  });

  // question prep is a background generation (v2-speed §3.2): poll until it
  // lands, the same way the intake screen does
  let kase = await (await request.get(`/api/cases/${caseId}`)).json();
  for (let i = 0; i < 200 && kase.workflow.stages.preop.gap_analysis !== "complete"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    kase = await (await request.get(`/api/cases/${caseId}`)).json();
  }
  await request.put(`/api/cases/${caseId}/questions`, {
    data: {
      questions: kase.open_questions.map((q: object) => ({ ...q, review: "approved" })),
      provider_id: providerId,
    },
  });

  await request.post(`/api/cases/${caseId}/sources/audio`, {
    multipart: {
      kind: "preop-interview",
      provider_id: providerId,
      file: { name: "preop-interview.wav", mimeType: "audio/wav", buffer: makeWav() },
    },
  });
  await request.post(`/api/cases/${caseId}/stages/preop/run`, {
    data: { provider_id: providerId },
  });
  await request.post(`/api/cases/${caseId}/stages/preop/signoff`, {
    data: { provider_id: providerId },
  });
  return caseId;
}
