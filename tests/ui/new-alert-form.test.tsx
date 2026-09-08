// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { createAlert, refresh } = vi.hoisted(() => ({ createAlert: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(app)/alerts/actions", () => ({ createAlertAction: createAlert }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import NewAlertForm from "@/app/(app)/alerts/NewAlertForm";

const printings = [
  { printingId: 2, subtype: "Normal", market: 0.25, priceDate: "2026-09-07" },
  { printingId: 3, subtype: "Reverse Holofoil", market: 1.1, priceDate: "2026-09-07" },
];
const hit = {
  cardId: 2, name: "Pikachu", number: "025/131", rarity: "Common", imageUrl: null,
  setName: "Prismatic Evolutions", gameSlug: "pokemon", printings,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  createAlert.mockReset().mockResolvedValue({ ok: true, data: 42 });
  refresh.mockReset();
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hits: [hit] }) });
  vi.stubGlobal("fetch", fetchMock);
});

async function searchAndPick() {
  render(<NewAlertForm />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "pika" } });
  fireEvent.click(await screen.findByRole("button", { name: /Pikachu/ }));
}

describe("NewAlertForm", () => {
  it("searches, picks a card, defaults to the first printing and 'drops below', hints and creates", async () => {
    await searchAndPick();
    expect(fetchMock).toHaveBeenCalledWith("/api/search?q=pika");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Normal · $0.25" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Reverse Holofoil · $1.10" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "drops below" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "rises above" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.change(screen.getByLabelText(/Price \(USD\)/), { target: { value: "0.20" } });
    expect(screen.getByText("20% under today")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create alert" }));
    await waitFor(() => expect(createAlert).toHaveBeenCalledWith({ printingId: 2, direction: "below", threshold: 0.2 }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // Back to the search step with a clean slate.
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("sends 'above' when 'rises above' is picked and hints the distance over today's market", async () => {
    await searchAndPick();
    fireEvent.click(screen.getByRole("button", { name: "rises above" }));
    expect(screen.getByRole("button", { name: "rises above" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "drops below" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.change(screen.getByLabelText(/Price \(USD\)/), { target: { value: "0.5" } });
    expect(screen.getByText("100% over today")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create alert" }));
    await waitFor(() => expect(createAlert).toHaveBeenCalledWith({ printingId: 2, direction: "above", threshold: 0.5 }));
  });

  it("uses the chosen printing", async () => {
    await searchAndPick();
    fireEvent.click(screen.getByRole("button", { name: "Reverse Holofoil · $1.10" }));
    fireEvent.change(screen.getByLabelText(/Price \(USD\)/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create alert" }));
    await waitFor(() => expect(createAlert).toHaveBeenCalledWith({ printingId: 3, direction: "below", threshold: 1 }));
  });

  it("shows the action's error as an alert and keeps the form where it is", async () => {
    createAlert.mockResolvedValueOnce({ ok: false, error: "You can have at most 100 alerts" });
    await searchAndPick();
    fireEvent.change(screen.getByLabelText(/Price \(USD\)/), { target: { value: "0.2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create alert" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("You can have at most 100 alerts"));
    expect(screen.getByRole("button", { name: "Normal · $0.25" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Price \(USD\)/)).toHaveValue(0.2);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports a thrown action as a network problem", async () => {
    createAlert.mockRejectedValueOnce(new Error("boom"));
    await searchAndPick();
    fireEvent.change(screen.getByLabelText(/Price \(USD\)/), { target: { value: "0.2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create alert" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not reach the server/i));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("skips the search step when a printing is preselected and starts on that printing", () => {
    render(
      <NewAlertForm
        preselected={{ printingId: 3, name: "Pikachu", subtitle: "Prismatic Evolutions · 025/131", imageUrl: null, printings }}
      />
    );
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByText("Pikachu")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reverse Holofoil · $1.10" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Normal · $0.25" })).toHaveAttribute("aria-pressed", "false");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("'Change' goes back to the search step", async () => {
    render(
      <NewAlertForm
        preselected={{ printingId: 3, name: "Pikachu", subtitle: "Prismatic Evolutions · 025/131", imageUrl: null, printings }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create alert" })).not.toBeInTheDocument();
  });

  it("disables Create while the price is empty and shows no hint", async () => {
    await searchAndPick();
    expect(screen.getByRole("button", { name: "Create alert" })).toBeDisabled();
    expect(screen.queryByText(/today$/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Price \(USD\)/), { target: { value: "0.3" } });
    expect(screen.getByRole("button", { name: "Create alert" })).toBeEnabled();
  });

  it("does not search for a one-character query and says when nothing matches", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ hits: [] }) });
    render(<NewAlertForm />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "p" } });
    await new Promise((r) => setTimeout(r, 320));
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    await waitFor(() => expect(screen.getByText("No cards match “zzz”.")).toBeInTheDocument());
  });
});
