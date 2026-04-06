import { parseArgs } from 'node:util';
import { getDb, closeDb } from './db/connection.js';
import { ensureSchema } from './db/schema.js';
import { AudibleFetcher } from './fetchers/audible.js';
import type { Fetcher } from './fetchers/types.js';

const { values } = parseArgs({
  options: {
    source: { type: 'string', default: 'audible' },
    year: { type: 'string', default: String(new Date().getFullYear()) },
    incremental: { type: 'boolean', default: false },
  },
  strict: false,
});

const year = parseInt(values.year as string, 10);
const source = values.source as string;
const incremental = values.incremental as boolean;

if (isNaN(year)) {
  console.error('Invalid --year');
  process.exit(1);
}

async function main() {
  const db = getDb();
  ensureSchema(db);

  const fetchers: Record<string, Fetcher> = {
    audible: new AudibleFetcher(db),
  };

  const fetcher = fetchers[source];
  if (!fetcher) {
    console.error(`Unknown source: ${source}. Available: ${Object.keys(fetchers).join(', ')}`);
    process.exit(1);
  }

  console.log(`Fetching from ${source} for year ${year} (incremental: ${incremental})`);
  const result = await fetcher.fetch({ year, incremental });

  console.log(`\nDone: ${result.booksNew} new, ${result.booksUpdated} updated, ${result.errors.length} errors`);
  if (result.errors.length > 0) {
    console.log('Errors:');
    for (const err of result.errors) {
      console.log(`  - ${err}`);
    }
  }

  closeDb();
}

main().catch(err => {
  console.error(err);
  closeDb();
  process.exit(1);
});
