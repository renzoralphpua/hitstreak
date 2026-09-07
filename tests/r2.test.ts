import { describe, it, expect, vi } from "vitest";
import { createRawArchiver } from "@/ingest/r2";

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
