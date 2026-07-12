/** REST client (ui.md §3): every response parses through zod at the boundary. */
import axios from "axios";
import { z } from "zod";
import {
  CaseSchema,
  CaseSummarySchema,
  ChatMessageSchema,
  ClaimReviewsSchema,
  ProviderSchema,
  StockLevelSchema,
  type Case,
  type CaseSummary,
  type ChatMessage,
  type ClaimReviews,
  type ClaimReviewState,
  type OpenQuestion,
  type Provider,
  type StockLevel,
} from "./schema";

export async function fetchCases(): Promise<CaseSummary[]> {
  const { data } = await axios.get("/api/cases");
  return z.array(CaseSummarySchema).parse(data);
}

export async function fetchCase(caseId: string): Promise<Case> {
  const { data } = await axios.get(`/api/cases/${encodeURIComponent(caseId)}`);
  return CaseSchema.parse(data);
}

export function audioUrl(caseId: string, sourceId: string): string {
  return `/api/cases/${encodeURIComponent(caseId)}/audio/${encodeURIComponent(sourceId)}`;
}

// ---- write path (spec v2 §5.2) ---------------------------------------------

export async function fetchProviders(): Promise<Provider[]> {
  const { data } = await axios.get("/api/providers");
  return z.array(ProviderSchema).parse(data);
}

export async function createCase(label: string, providerId: string): Promise<Case> {
  const { data } = await axios.post("/api/cases", { label, provider_id: providerId });
  return CaseSchema.parse(data);
}

export async function addDocumentText(
  caseId: string,
  docType: string,
  text: string,
  providerId: string,
): Promise<Case> {
  const { data } = await axios.post(
    `/api/cases/${encodeURIComponent(caseId)}/sources/document`,
    { doc_type: docType, text, provider_id: providerId },
  );
  return CaseSchema.parse(data);
}

export async function uploadDocumentFile(
  caseId: string,
  docType: string,
  file: File,
  providerId: string,
): Promise<Case> {
  const form = new FormData();
  form.append("file", file);
  form.append("doc_type", docType);
  form.append("provider_id", providerId);
  const { data } = await axios.post(
    `/api/cases/${encodeURIComponent(caseId)}/sources/document`,
    form,
  );
  return CaseSchema.parse(data);
}

export async function analyzeQuestions(caseId: string): Promise<Case> {
  const { data } = await axios.post(
    `/api/cases/${encodeURIComponent(caseId)}/questions/analyze`,
  );
  return CaseSchema.parse(data);
}

export async function reviewQuestions(
  caseId: string,
  questions: OpenQuestion[],
  providerId: string,
): Promise<Case> {
  const { data } = await axios.put(
    `/api/cases/${encodeURIComponent(caseId)}/questions`,
    { questions, provider_id: providerId },
  );
  return CaseSchema.parse(data);
}

export async function uploadAudio(
  caseId: string,
  kind: string,
  file: File,
  providerId: string,
  confirm = false,
): Promise<Case> {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  form.append("provider_id", providerId);
  const { data } = await axios.post(
    `/api/cases/${encodeURIComponent(caseId)}/sources/audio`,
    form,
    { params: confirm ? { confirm: "true" } : {} },
  );
  return CaseSchema.parse(data);
}

/** Sign a stage off; on pre-op, `equipment` carries the ticked suggested
 * items — the server reserves each for the case as the stage completes. */
export async function signoffStage(
  caseId: string,
  stage: string,
  providerId: string,
  equipment: string[] = [],
): Promise<Case> {
  const { data } = await axios.post(
    `/api/cases/${encodeURIComponent(caseId)}/stages/${encodeURIComponent(stage)}/signoff`,
    { provider_id: providerId, equipment },
  );
  return CaseSchema.parse(data);
}

export async function reopenStage(
  caseId: string,
  stage: string,
  providerId: string,
): Promise<Case> {
  const { data } = await axios.post(
    `/api/cases/${encodeURIComponent(caseId)}/stages/${encodeURIComponent(stage)}/reopen`,
    { provider_id: providerId },
  );
  return CaseSchema.parse(data);
}

/** Add a provider-asserted fact to a stage artifact; the new claim cites
 * the provider's own `edit:<provider_id>` source. */
export async function addArtifactClaim(
  caseId: string,
  artifactId: string,
  text: string,
  providerId: string,
): Promise<Case> {
  const { data } = await axios.post(
    `/api/cases/${encodeURIComponent(caseId)}/artifacts/${encodeURIComponent(artifactId)}/claims`,
    { text, provider_id: providerId },
  );
  return CaseSchema.parse(data);
}

/** Rewrite one claim's text as a provider-attested correction. */
export async function editArtifactClaim(
  caseId: string,
  artifactId: string,
  claimId: string,
  text: string,
  providerId: string,
): Promise<Case> {
  const { data } = await axios.put(
    `/api/cases/${encodeURIComponent(caseId)}/artifacts/${encodeURIComponent(artifactId)}/claims/${encodeURIComponent(claimId)}`,
    { text, provider_id: providerId },
  );
  return CaseSchema.parse(data);
}

export async function fetchClaimReviews(caseId: string): Promise<ClaimReviews> {
  const { data } = await axios.get(
    `/api/cases/${encodeURIComponent(caseId)}/claim-reviews`,
  );
  return ClaimReviewsSchema.parse(data);
}

export async function reviewClaim(
  caseId: string,
  ref: string,
  state: ClaimReviewState | null,
  providerId: string,
): Promise<ClaimReviews> {
  const { data } = await axios.post(
    `/api/cases/${encodeURIComponent(caseId)}/claim-reviews`,
    { ref, state, provider_id: providerId },
  );
  return ClaimReviewsSchema.parse(data);
}

export async function acknowledgeHandoff(caseId: string, providerId: string): Promise<Case> {
  const { data } = await axios.post(
    `/api/cases/${encodeURIComponent(caseId)}/handoff/ack`,
    { provider_id: providerId },
  );
  return CaseSchema.parse(data);
}

// ---- case chatbot + equipment store ------------------------------------------

export async function fetchChatHistory(caseId: string): Promise<ChatMessage[]> {
  const { data } = await axios.get(`/api/cases/${encodeURIComponent(caseId)}/chat`);
  return z.array(ChatMessageSchema).parse(data);
}

export async function fetchEquipment(): Promise<StockLevel[]> {
  const { data } = await axios.get("/api/equipment");
  return z.array(StockLevelSchema).parse(data);
}
