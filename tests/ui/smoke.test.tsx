// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

function Hello() {
  return <h1>hello</h1>;
}

describe("component test tooling", () => {
  it("renders React into jsdom with jest-dom matchers", () => {
    render(<Hello />);
    expect(screen.getByRole("heading", { name: "hello" })).toBeInTheDocument();
  });
});
