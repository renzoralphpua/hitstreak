// Polite HTTP client for tcgcsv.com (identified UA, inter-request delay, retry).
// All shapes mirror TCGplayer's API as mirrored by tcgcsv: { results: [...] }.
// No runtime validation is performed - the types below mirror tcgcsv's JSON shapes;
// a 200 response body without a `results` key yields [].

export interface TcgcsvGroup {
  groupId: number;
  name: string;
  abbreviation?: string;
  publishedOn?: string;
}

export interface TcgcsvExtendedData {
  name: string;
  displayName?: string;
  value: string;
}

export interface TcgcsvProduct {
  productId: number;
  name: string;
  imageUrl?: string;
  extendedData?: TcgcsvExtendedData[];
}

export interface TcgcsvPrice {
  productId: number;
  subTypeName: string;
  marketPrice?: number | null;
  lowPrice?: number | null;
  midPrice?: number | null;
  highPrice?: number | null;
}

export interface TcgcsvClientOptions {
  fetchImpl?: typeof fetch;
  delayMs?: number; // polite delay before each request (tcgcsv guidance ~250ms)
  maxRetries?: number; // applies to 429 / 5xx responses and network errors (other non-OK statuses throw immediately)
  baseUrl?: string;
  timeoutMs?: number; // per-request abort timeout
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createTcgcsvClient(opts: TcgcsvClientOptions = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const delayMs = opts.delayMs ?? 250;
  const maxRetries = opts.maxRetries ?? 2;
  const baseUrl = opts.baseUrl ?? "https://tcgcsv.com";
  const timeoutMs = opts.timeoutMs ?? 30_000;

  async function getResults<T>(path: string): Promise<T[]> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const wait = attempt === 0 ? delayMs : delayMs * 2 ** attempt;
      if (wait > 0) await sleep(wait);
      try {
        const res = await fetchImpl(`${baseUrl}${path}`, {
          headers: { "User-Agent": "hitstreak-ingest/1.0 (github.com/renzoralphpua/hitstreak)" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) {
          const body = (await res.json()) as { results?: T[] };
          return body.results ?? [];
        }
        await res.text().catch(() => {}); // release the connection
        lastError = new Error(`tcgcsv GET ${path} -> ${res.status}`);
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable) break;
      } catch (e) {
        lastError = e; // network error / timeout: retry
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  return {
    fetchGroups: (categoryId: number) => getResults<TcgcsvGroup>(`/tcgplayer/${categoryId}/groups`),
    fetchProducts: (categoryId: number, groupId: number) =>
      getResults<TcgcsvProduct>(`/tcgplayer/${categoryId}/${groupId}/products`),
    fetchPrices: (categoryId: number, groupId: number) =>
      getResults<TcgcsvPrice>(`/tcgplayer/${categoryId}/${groupId}/prices`),
  };
}

export type TcgcsvClient = ReturnType<typeof createTcgcsvClient>;
