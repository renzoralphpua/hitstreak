import { describe, it, expect, vi, afterEach } from "vitest";
import { createRawArchiver, rawArchiverFromEnv } from "@/ingest/r2";

describe("raw archiver", () => {
  it("puts JSON under raw/tcgplayer/<date>/<category>/<name>.json", async () => {
    const send = vi.fn().mockResolvedValue({});
    const archiver = createRawArchiver({ s3: { send } as never, bucket: "hitstreak-raw" });
    await archiver.putRaw("2026-09-05", 3, "604-prices", { results: [] });

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0][0];
    expect(cmd.input.Bucket).toBe("hitstreak-raw");
    expect(cmd.input.Key).toBe("raw/tcgplayer/2026-09-05/3/604-prices.json");
    expect(cmd.input.ContentType).toBe("application/json");
    expect(JSON.parse(cmd.input.Body as string)).toEqual({ results: [] });
  });

  it("is a no-op when disabled (no bucket configured)", async () => {
    const archiver = createRawArchiver({ s3: null, bucket: undefined });
    expect(archiver.enabled).toBe(false);
    await expect(archiver.putRaw("2026-09-05", 3, "groups", {})).resolves.toBeUndefined();
  });
});

describe("rawArchiverFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is enabled when all four R2 env vars are set", () => {
    vi.stubEnv("R2_ACCOUNT_ID", "acct");
    vi.stubEnv("R2_ACCESS_KEY_ID", "key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
    vi.stubEnv("R2_BUCKET", "hitstreak-raw");

    const archiver = rawArchiverFromEnv();
    expect(archiver.enabled).toBe(true);
  });

  it("is disabled when R2_BUCKET is missing", () => {
    vi.stubEnv("R2_ACCOUNT_ID", "acct");
    vi.stubEnv("R2_ACCESS_KEY_ID", "key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
    vi.stubEnv("R2_BUCKET", undefined);

    const archiver = rawArchiverFromEnv();
    expect(archiver.enabled).toBe(false);
  });

  it("is disabled when no R2 env vars are set", () => {
    vi.stubEnv("R2_ACCOUNT_ID", undefined);
    vi.stubEnv("R2_ACCESS_KEY_ID", undefined);
    vi.stubEnv("R2_SECRET_ACCESS_KEY", undefined);
    vi.stubEnv("R2_BUCKET", undefined);

    const archiver = rawArchiverFromEnv();
    expect(archiver.enabled).toBe(false);
  });
});
