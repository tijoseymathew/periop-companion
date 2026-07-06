/** REST client (ui.md §3): every response parses through zod at the boundary. */
import axios from "axios";
import { z } from "zod";
import {
  CaseSchema,
  CaseSummarySchema,
  ProviderSchema,
  type Case,
  type CaseSummary,
  type OpenQuestion,
  type Provider,
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
