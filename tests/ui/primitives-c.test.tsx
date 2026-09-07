// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState, MoneyDisplay } from "@/components/ui";

describe("EmptyState", () => {
  it("renders a title heading, body text, and the action node", () => {
    render(<EmptyState title="No cards yet" body="Add your first card to get started." action={<button>Add card</button>} />);
    expect(screen.getByRole("heading", { name: "No cards yet" })).toBeInTheDocument();
    expect(screen.getByText("Add your first card to get started.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add card" })).toBeInTheDocument();
  });

  it("omits the body when not given", () => {
    render(<EmptyState title="Empty" />);
    expect(screen.getByRole("heading", { name: "Empty" })).toBeInTheDocument();
    expect(screen.queryByText(/get started/i)).not.toBeInTheDocument();
  });
});

describe("MoneyDisplay", () => {
  it("renders whole dollars in a display-font element and cents dimmed", () => {
    render(<MoneyDisplay amount={4812.4} />);
    const whole = screen.getByText("$4,812");
    expect(whole.className).toMatch(/font-display/);
    const cents = screen.getByText(".40");
    expect(cents.className).toMatch(/text-dim/);
    expect(whole.textContent).toBe("$4,812.40");
  });

  it("renders an em dash for null amounts", () => {
    render(<MoneyDisplay amount={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("applies the lg size class", () => {
    render(<MoneyDisplay amount={12} size="lg" />);
    expect(screen.getByText("$12").className).toMatch(/text-\[56px\]/);
  });
});
