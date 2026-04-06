export interface FetcherResult {
  source: string;
  booksFound: number;
  booksNew: number;
  booksUpdated: number;
  errors: string[];
}

export interface Fetcher {
  name: string;
  fetch(options: { year: number; incremental: boolean }): Promise<FetcherResult>;
}
