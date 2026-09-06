// Polite HTTP client for tcgcsv.com (identified UA, inter-request delay, retry).
// All shapes mirror TCGplayer's API as mirrored by tcgcsv: { results: [...] }.

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
  maxRetries?: number; // retries on non-2xx / network error
  baseUrl?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createTcgcsvClient(opts: TcgcsvClientOptions = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const delayMs = opts.delayMs ?? 250;
  const maxRetries = opts.maxRetries ?? 2;
  const baseUrl = opts.baseUrl ?? "https://tcgcsv.com";

  async function getResults<T>(path: string): Promise<T[]> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (delayMs > 0) await sleep(delayMs);
      try {
        const res = await fetchImpl(`${baseUrl}${path}`, {
          headers: { "User-Agent": "hitstreak-ingest/1.0 (github.com/renzoralphpua/hitstreak)" },
        });
        if (!res.ok) {
          lastError = new Error(`tcgcsv GET ${path} -> ${res.status}`);
          continue;
        }
        const body = (await res.json()) as { results?: T[] };
        return body.results ?? [];
      } catch (e) {
        lastError = e;
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
