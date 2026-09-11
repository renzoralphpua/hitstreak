// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// vi.hoisted: the mock factory runs with the hoisted imports, i.e. before plain
// `const` declarations here would be initialized.
const { signIn, signUp, push } = vi.hoisted(() => ({ signIn: vi.fn(), signUp: vi.fn(), push: vi.fn() }));
signIn.mockResolvedValue({ error: null });
signUp.mockResolvedValue({ error: null });
vi.mock("@/lib/auth-client", () => ({ authClient: { signIn: { email: signIn }, signUp: { email: signUp } } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import AuthForm from "@/app/(auth)/AuthForm";

describe("AuthForm", () => {
  it("sign-in submits email + password and navigates to /collections", async () => {
    render(<AuthForm mode="sign-in" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "r@x.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw12345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith(expect.objectContaining({ email: "r@x.com", password: "pw12345678" })));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/collections"));
  });
  it("sign-up also sends the name and shows an API error", async () => {
    signUp.mockResolvedValueOnce({ error: { message: "User already exists" } });
    render(<AuthForm mode="sign-up" />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renzo" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "r@x.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw12345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("User already exists"));
  });
  it("shows a network error and re-enables the submit button when the auth call rejects", async () => {
    signIn.mockRejectedValueOnce(new Error("ECONNRESET"));
    render(<AuthForm mode="sign-in" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "r@x.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw12345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not reach the server. Try again."));
    expect(screen.getByRole("button", { name: "Sign in" })).not.toBeDisabled();
  });
});
