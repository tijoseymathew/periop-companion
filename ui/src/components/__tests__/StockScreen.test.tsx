import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StockScreen } from "../equipment/StockScreen";
import { fetchEquipment } from "../../lib/api";
import type { StockLevel } from "../../lib/schema";

vi.mock("../../lib/api", () => ({ fetchEquipment: vi.fn() }));
const mockFetch = vi.mocked(fetchEquipment);

const LEVELS: StockLevel[] = [
  {
    item_id: "ett-7.0",
    name: "Endotracheal tube 7.0 mm",
    category: "airway",
    total: 12,
    reserved: 2,
    available: 10,
    reservations: [
      { item_id: "ett-7.0", case_id: "sg-0001", qty: 2, by: "p-lim", at: "2026-07-11T02:00:00Z" },
    ],
  },
  {
    item_id: "bis-monitor",
    name: "Depth-of-anaesthesia (BIS) monitor",
    category: "monitoring",
    total: 2,
    reserved: 2,
    available: 0,
    reservations: [
      { item_id: "bis-monitor", case_id: "sg-0002", qty: 2, by: "p-tan", at: "2026-07-11T02:00:00Z" },
    ],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue(LEVELS);
});

describe("StockScreen", () => {
  it("groups the shelf by category with availability and assignments", async () => {
    render(<StockScreen onBack={vi.fn()} />);
    expect(await screen.findByText("Endotracheal tube 7.0 mm")).toBeInTheDocument();
    expect(screen.getByText("airway")).toBeInTheDocument();
    expect(screen.getByText("monitoring")).toBeInTheDocument();
    expect(screen.getByText("10 of 12")).toBeInTheDocument();
    expect(screen.getByText("sg-0001 × 2")).toBeInTheDocument();
  });

  it("flags exhausted items", async () => {
    render(<StockScreen onBack={vi.fn()} />);
    expect(await screen.findByText("0 of 2")).toBeInTheDocument();
  });

  it("refresh refetches the store", async () => {
    render(<StockScreen onBack={vi.fn()} />);
    await screen.findByText("Endotracheal tube 7.0 mm");
    await userEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("back returns to the worklist", async () => {
    const onBack = vi.fn();
    render(<StockScreen onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: /Worklist/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it("surfaces a load failure", async () => {
    mockFetch.mockRejectedValue(new Error("boom"));
    render(<StockScreen onBack={vi.fn()} />);
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });
});
