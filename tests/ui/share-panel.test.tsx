// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ShareLink } from "@/lib/share";

const { enable, regenerate, disable, refresh } = vi.hoisted(() => ({
  enable: vi.fn(), regenerate: vi.fn(), disable: vi.fn(), refresh: vi.fn(),
}));
vi.mock("@/app/(app)/collections/actions", () => ({
  enableShareAction: enable, regenerateShareAction: regenerate, disableShareAction: disable,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import SharePanel from "@/app/(app)/collections/[slug]/SharePanel";

const TOKEN = "abcdefghijklmnopqrstuv";
const NEW_TOKEN = "ZYXWVUTSRQPONMLKJIHGFE";
const link = (over: Partial<ShareLink> = {}): ShareLink => ({ token: TOKEN, enabled: true, createdAt: "2026-09-07T00:00:00.000Z", ...over });

const writeText = vi.fn();

beforeEach(() => {
  enable.mockReset().mockResolvedValue({ ok: true, data: link() });
  regenerate.mockReset().mockResolvedValue({ ok: true, data: link({ token: NEW_TOKEN }) });
  disable.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("SharePanel", () => {
  it("is Off with no link and turns on through enableShareAction", async () => {
    render(<SharePanel collectionId={7} link={null} />);
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.queryByLabelText("Share link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Share this collection" }));
    await waitFor(() => expect(enable).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.getByLabelText("Share link")).toHaveTextContent(`/s/${TOKEN}`));
    expect(screen.getByText("Anyone with the link can view")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("treats a disabled link as Off and re-enables it", async () => {
    render(<SharePanel collectionId={7} link={link({ enabled: false })} />);
    expect(screen.getByText("Off")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Share this collection" }));
    await waitFor(() => expect(enable).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.getByText("Anyone with the link can view")).toBeInTheDocument());
  });

  it("Copy link writes the absolute URL for the current origin and confirms", async () => {
    render(<SharePanel collectionId={7} link={link()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`http://localhost:3000/s/${TOKEN}`));
    await waitFor(() => expect(screen.getByText("Link copied.")).toBeInTheDocument());
    expect(enable).not.toHaveBeenCalled();
    expect(regenerate).not.toHaveBeenCalled();
    expect(disable).not.toHaveBeenCalled();
  });

  it("explains when the clipboard is unavailable", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    render(<SharePanel collectionId={7} link={link()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t copy/i));
  });

  it("Turn off calls disableShareAction and goes back to Off", async () => {
    render(<SharePanel collectionId={7} link={link()} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(disable).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.getByText("Off")).toBeInTheDocument());
    expect(screen.queryByLabelText("Share link")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share this collection" })).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("New link confirms first, then regenerates and shows the new token", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SharePanel collectionId={7} link={link()} />);
    fireEvent.click(screen.getByRole("button", { name: "New link" }));
    expect(confirm).toHaveBeenCalledWith("Replace the link? The old one will stop working.");
    await waitFor(() => expect(regenerate).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.getByLabelText("Share link")).toHaveTextContent(`/s/${NEW_TOKEN}`));
    expect(screen.getByText("Anyone with the link can view")).toBeInTheDocument();
  });

  it("New link does nothing when the confirm is dismissed", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<SharePanel collectionId={7} link={link()} />);
    fireEvent.click(screen.getByRole("button", { name: "New link" }));
    expect(regenerate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Share link")).toHaveTextContent(`/s/${TOKEN}`);
  });

  it("surfaces an action error as an alert and keeps the current state", async () => {
    enable.mockResolvedValueOnce({ ok: false, error: "Collection not found" });
    render(<SharePanel collectionId={7} link={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Share this collection" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Collection not found"));
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports a thrown action as a network problem", async () => {
    disable.mockRejectedValueOnce(new Error("boom"));
    render(<SharePanel collectionId={7} link={link()} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not reach the server/i));
    expect(screen.getByLabelText("Share link")).toHaveTextContent(`/s/${TOKEN}`);
  });
});
