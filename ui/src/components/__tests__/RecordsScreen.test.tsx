import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RecordsScreen } from "../flow/RecordsScreen";
import { CaseSchema } from "../../lib/schema";

function renderScreen(over: Partial<Parameters<typeof RecordsScreen>[0]> = {}) {
  const props = {
    kase: null,
    busy: false,
    notice: null,
    canWrite: true,
    onCreateIntake: vi.fn(),
    onUploadDocument: vi.fn(),
    onContinue: vi.fn(),
    ...over,
  };
  const view = render(<RecordsScreen {...props} />);
  return { props, view };
}

async function fillCase() {
  await userEvent.type(screen.getByPlaceholderText(/James Whitfield/), "Amara Okafor");
  await userEvent.type(
    screen.getByPlaceholderText(/Elective open right/),
    "Elective lap chole under GA.",
  );
}

function stageFile(name: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["# GP summary\n\nOn amlodipine."], name, { type: "text/plain" });
  return userEvent.upload(input, file);
}

describe("RecordsScreen — new case", () => {
  it("keeps Create intake disabled until described with a document", async () => {
    renderScreen();
    const cta = screen.getByRole("button", { name: /Create intake/ });
    expect(cta).toBeDisabled();
    await fillCase();
    expect(cta).toBeDisabled(); // still no document
    await stageFile("gp-letter.txt");
    expect(cta).toBeEnabled();
  });

  it("stages files with a guessed tag and hands everything to Create intake", async () => {
    const { props } = renderScreen();
    await fillCase();
    await stageFile("gp-letter.txt");
    const tag = screen.getByLabelText("Tag for gp-letter.txt") as HTMLSelectElement;
    expect(tag.value).toBe("gp-summary");
    await userEvent.click(screen.getByRole("button", { name: /Create intake/ }));
    expect(props.onCreateIntake).toHaveBeenCalledWith(
      "Amara Okafor",
      "Elective lap chole under GA.",
      [expect.objectContaining({ tag: "gp-summary" })],
    );
  });

  it("marks recommended documents as they arrive", async () => {
    renderScreen();
    await fillCase();
    await stageFile("meds-current.txt");
    const rail = screen.getByText("Recommended documents").parentElement!;
    // description + med list ticked, the others not yet
    expect(rail.textContent).toContain("Case description / op plan");
    expect((screen.getByLabelText("Tag for meds-current.txt") as HTMLSelectElement).value).toBe(
      "med-list",
    );
  });

  it("asks for a provider before anything can be created", () => {
    renderScreen({ canWrite: false });
    expect(screen.getByText(/Pick a provider/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create intake/ })).toBeDisabled();
  });

  it("guesses the newer document types from the filename too", async () => {
    renderScreen();
    await fillCase();
    await stageFile("prior-operation-report.txt");
    expect(
      (screen.getByLabelText("Tag for prior-operation-report.txt") as HTMLSelectElement).value,
    ).toBe("op-notes");
    await stageFile("bloods-panel.txt");
    expect((screen.getByLabelText("Tag for bloods-panel.txt") as HTMLSelectElement).value).toBe(
      "investigations",
    );
  });

  it("offers every document type in the tag dropdown, not just the guess", async () => {
    renderScreen();
    await fillCase();
    await stageFile("mystery.txt");
    const tag = screen.getByLabelText("Tag for mystery.txt") as HTMLSelectElement;
    const options = Array.from(tag.options).map((o) => o.value);
    expect(options).toEqual(
      expect.arrayContaining([
        "gp-summary",
        "med-list",
        "prior-anesthetic-record",
        "op-notes",
        "investigations",
        "discharge-summary",
        "allergy-record",
        "other",
      ]),
    );
  });
});

describe("RecordsScreen — question prep failure", () => {
  it("shows a retry banner instead of blocking the records", async () => {
    const onRetry = vi.fn();
    renderScreen({
      kase: CaseSchema.parse({ case_id: "sg-t", label: "Amara Okafor" }),
      gapFailure: { message: "the NIM timed out", onRetry },
    });
    expect(screen.getByText(/Question prep stopped/)).toBeInTheDocument();
    expect(screen.getByText(/the NIM timed out/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });
});
