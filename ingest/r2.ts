// Raw-response archiver to Cloudflare R2 (S3-compatible). Disabled gracefully
// when R2 env is absent (local dev), so ingestion still works without it.
//
// Contract: putRaw errors PROPAGATE. Callers must not catch-and-continue past a failed archive —
// a group's raw response must be durably archived before its rows are written (archive-first).
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

export interface RawArchiverOptions {
  s3: S3Client | null;
  bucket: string | undefined;
}

export function createRawArchiver(opts: RawArchiverOptions) {
  return {
    enabled: Boolean(opts.s3 && opts.bucket),
    async putRaw(date: string, categoryId: number, name: string, body: unknown): Promise<void> {
      if (!opts.s3 || !opts.bucket) return;
      await opts.s3.send(
        new PutObjectCommand({
          Bucket: opts.bucket,
          Key: `raw/tcgplayer/${date}/${categoryId}/${name}.json`,
          Body: JSON.stringify(body),
          ContentType: "application/json",
        })
      );
    },

    /**
     * Mirrors an image into the bucket and returns its public URL, or null when mirroring is not
     * possible — no bucket, or no `R2_PUBLIC_BASE_URL` to serve it from. Null is not a failure: the
     * caller falls back to the upstream URL, which is how card art already works.
     *
     * Unlike `putRaw`, a failure here does NOT propagate. Set art is decoration; losing it must
     * never fail an enrichment run that also carries the era each set belongs to.
     */
    async putImage(key: string, body: Uint8Array, contentType: string): Promise<string | null> {
      const base = process.env.R2_PUBLIC_BASE_URL;
      if (!opts.s3 || !opts.bucket || !base) return null;
      try {
        await opts.s3.send(
          new PutObjectCommand({ Bucket: opts.bucket, Key: key, Body: body, ContentType: contentType })
        );
        return `${base.replace(/\/$/, "")}/${key}`;
      } catch {
        return null;
      }
    },
  };
}

export function rawArchiverFromEnv() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return createRawArchiver({ s3: null, bucket: undefined });
  }
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // A hung R2 connection would otherwise stall the whole sequential nightly job.
    requestHandler: new NodeHttpHandler({ connectionTimeout: 5_000, requestTimeout: 30_000 }),
  });
  return createRawArchiver({ s3, bucket });
}

export type RawArchiver = ReturnType<typeof createRawArchiver>;
