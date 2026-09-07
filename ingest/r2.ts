// Raw-response archiver to Cloudflare R2 (S3-compatible). Disabled gracefully
// when R2 env is absent (local dev), so ingestion still works without it.
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

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
  });
  return createRawArchiver({ s3, bucket });
}

export type RawArchiver = ReturnType<typeof createRawArchiver>;
