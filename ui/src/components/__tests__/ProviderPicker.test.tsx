/**
 * Provider picker (spec v2 §5.1): one tap, honest framing — attribution,
 * not identity. The only "setup" in the product (v2 §6.6).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProviderPicker } from "../ProviderPicker";

const PROVIDERS = [
  { provider_id: "p-lim", name: "Dr A. Lim", role: "consultant" },
  { provider_id: "p-tan", name: "Dr B. Tan", role: "registrar" },
];

describe("ProviderPicker", () => {
  it("lists every provider by name", () => {
    render(<ProviderPicker providers={PROVIDERS} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("option", { name: /Dr A\. Lim/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Dr B\. Tan/ })).toBeInTheDocument();
  });

  it("selection fires with the provider id", async () => {
    const onSelect = vi.fn();
    render(<ProviderPicker providers={PROVIDERS} selected={null} onSelect={onSelect} />);
    await userEvent.selectOptions(screen.getByLabelText(/working as/i), "p-tan");
    expect(onSelect).toHaveBeenCalledWith("p-tan");
  });

  it("shows the current selection", () => {
    render(<ProviderPicker providers={PROVIDERS} selected="p-lim" onSelect={vi.fn()} />);
    expect(screen.getByLabelText(/working as/i)).toHaveValue("p-lim");
  });
});
