// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LineChart from "@/components/ui/LineChart";

const pts = [
  { date: "2026-08-08", value: 10 },
  { date: "2026-08-20", value: 20 },
  { date: "2026-09-01", value: 15 },
];

describe("LineChart", () => {
  it("draws a step path across the range and labels the svg", () => {
    render(<LineChart points={pts} from="2026-08-08" to="2026-09-07" label="Umbreon ex market price, 30D" />);
    const svg = screen.getByRole("img", { name: "Umbreon ex market price, 30D" });
    const d = svg.querySelector("path")!.getAttribute("d")!;
    expect(d).toMatch(/^M0\.0 /);            // first point sits on the left edge
    expect(d).toMatch(/ H[\d.]+ V[\d.]+ H[\d.]+ V[\d.]+ H800$/); // step, step, carried to the right edge
    expect(d).not.toMatch(/NaN/);
    // axis labels at both ends
    expect(screen.getByText("Aug 8")).toBeInTheDocument();
    expect(screen.getByText("Sep 7")).toBeInTheDocument();
  });
  it("breaks the line at a null value", () => {
    render(<LineChart points={[pts[0], { date: "2026-08-15", value: null }, pts[2]]} from="2026-08-08" to="2026-09-07" label="x" />);
    const d = screen.getByRole("img").querySelector("path")!.getAttribute("d")!;
    expect(d.match(/M/g)).toHaveLength(2);
  });
  it("renders a flat line without dividing by zero", () => {
    render(<LineChart points={[{ date: "2026-08-08", value: 5 }, { date: "2026-08-20", value: 5 }]} from="2026-08-08" to="2026-09-07" label="x" />);
    expect(screen.getByRole("img").querySelector("path")!.getAttribute("d")).not.toMatch(/NaN|Infinity/);
  });
  it("shows the year in the axis labels for long ranges", () => {
    render(<LineChart points={pts} from="2025-09-07" to="2026-09-07" label="x" />);
    expect(screen.getByText("Sep 7, 2025")).toBeInTheDocument();
    expect(screen.getByText("Sep 7, 2026")).toBeInTheDocument();
  });
  it("says so when there is nothing to draw", () => {
    render(<LineChart points={[]} from="2026-08-08" to="2026-09-07" label="x" />);
    expect(screen.getByText("Not enough history yet.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
