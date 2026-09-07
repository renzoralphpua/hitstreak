import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// vitest.config.ts doesn't set `test.globals`, so @testing-library/react's
// built-in auto-cleanup (which checks for a global `afterEach`) never fires.
// Register it explicitly so DOM from one test doesn't leak into the next.
afterEach(cleanup);
