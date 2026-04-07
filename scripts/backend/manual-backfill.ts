/**
 * Manual backfill: insert known audiobook data for series with missing entries.
 * Ratings/covers will be populated on the next successful API fetch.
 *
 * Usage: npx tsx scripts/backend/manual-backfill.ts
 */

import { getDb, closeDb } from "./db.js";

interface ManualBook {
  id: string;          // Audible ASIN (placeholder if unknown)
  title: string;
  series_id: string;
  series_number: number;
  author: string;
  narrator: string;
  release_date: string; // YYYY-MM-DD
}

const BOOKS: ManualBook[] = [
  // Dungeon Crawler Carl — Matt Dinniman, narrated by Jeff Hays
  { id: "B08V8B2CGV", title: "Dungeon Crawler Carl", series_id: "dungeon-crawler-carl", series_number: 1, author: "Matt Dinniman", narrator: "Jeff Hays", release_date: "2021-01-28" },
  { id: "B094WYX4YZ", title: "Carl's Doomsday Scenario", series_id: "dungeon-crawler-carl", series_number: 2, author: "Matt Dinniman", narrator: "Jeff Hays", release_date: "2021-04-22" },
  { id: "B094XCNV6G", title: "The Dungeon Anarchist's Cookbook", series_id: "dungeon-crawler-carl", series_number: 3, author: "Matt Dinniman", narrator: "Jeff Hays", release_date: "2021-05-14" },
  { id: "B09GDJCJ45", title: "The Gate of the Feral Gods", series_id: "dungeon-crawler-carl", series_number: 4, author: "Matt Dinniman", narrator: "Jeff Hays", release_date: "2021-09-16" },
  { id: "B09ZJ9JZVJ", title: "The Butcher's Masquerade", series_id: "dungeon-crawler-carl", series_number: 5, author: "Matt Dinniman", narrator: "Jeff Hays", release_date: "2022-05-26" },
  { id: "B0CDXV6TVP", title: "The Eye of the Bedlam Bride", series_id: "dungeon-crawler-carl", series_number: 6, author: "Matt Dinniman", narrator: "Jeff Hays", release_date: "2023-09-01" },
  { id: "B0DK28NWPT", title: "This Inevitable Ruin", series_id: "dungeon-crawler-carl", series_number: 7, author: "Matt Dinniman", narrator: "Jeff Hays", release_date: "2025-02-11" },
  { id: "B0FXY6DVJS", title: "A Parade of Horribles", series_id: "dungeon-crawler-carl", series_number: 8, author: "Matt Dinniman", narrator: "Jeff Hays", release_date: "2026-05-12" },

  // The Primal Hunter — Zogarth, narrated by Travis Baldree
  { id: "B09N9GZWK3", title: "The Primal Hunter", series_id: "the-primal-hunter", series_number: 1, author: "Zogarth", narrator: "Travis Baldree", release_date: "2022-03-08" },
  { id: "B0B37DPN6T", title: "The Primal Hunter 2", series_id: "the-primal-hunter", series_number: 2, author: "Zogarth", narrator: "Travis Baldree", release_date: "2022-06-14" },
  { id: "B0B6JM8KKV", title: "The Primal Hunter 3", series_id: "the-primal-hunter", series_number: 3, author: "Zogarth", narrator: "Travis Baldree", release_date: "2022-08-30" },
  { id: "B0BK9W82PQ", title: "Primal Hunter 4", series_id: "the-primal-hunter", series_number: 4, author: "Zogarth", narrator: "Travis Baldree", release_date: "2022-12-06" },
  { id: "B0C34GCYVT", title: "The Primal Hunter 5", series_id: "the-primal-hunter", series_number: 5, author: "Zogarth", narrator: "Travis Baldree", release_date: "2023-05-17" },
  { id: "B0CC6FHBQM", title: "The Primal Hunter 6", series_id: "the-primal-hunter", series_number: 6, author: "Zogarth", narrator: "Travis Baldree", release_date: "2023-08-15" },
  { id: "B0CLNJQQD7", title: "The Primal Hunter 7", series_id: "the-primal-hunter", series_number: 7, author: "Zogarth", narrator: "Travis Baldree", release_date: "2023-11-21" },
  { id: "B0CWN2FQLY", title: "The Primal Hunter 8", series_id: "the-primal-hunter", series_number: 8, author: "Zogarth", narrator: "Travis Baldree", release_date: "2024-01-17" },
  { id: "B0D6H2N1YL", title: "The Primal Hunter 9", series_id: "the-primal-hunter", series_number: 9, author: "Zogarth", narrator: "Travis Baldree", release_date: "2024-07-02" },
  { id: "B0DJG16SRZ", title: "The Primal Hunter 10", series_id: "the-primal-hunter", series_number: 10, author: "Zogarth", narrator: "Travis Baldree", release_date: "2024-11-06" },
  { id: "B0DWG4J2SH", title: "The Primal Hunter 11", series_id: "the-primal-hunter", series_number: 11, author: "Zogarth", narrator: "Travis Baldree", release_date: "2025-03-05" },
  { id: "B0F8P6X1KR", title: "The Primal Hunter 12", series_id: "the-primal-hunter", series_number: 12, author: "Zogarth", narrator: "Travis Baldree", release_date: "2025-06-11" },
  { id: "B0G87LH5X8", title: "The Primal Hunter 13", series_id: "the-primal-hunter", series_number: 13, author: "Zogarth", narrator: "Travis Baldree", release_date: "2026-01-07" },

  // Defiance of the Fall — TheFirstDefier, JF Brink, narrated by Pavi Proczko
  { id: "B096G9C5H6", title: "Defiance of the Fall", series_id: "defiance-of-the-fall", series_number: 1, author: "TheFirstDefier, JF Brink", narrator: "Pavi Proczko", release_date: "2021-06-08" },
  { id: "B099JDQNHZ", title: "Defiance of the Fall 2", series_id: "defiance-of-the-fall", series_number: 2, author: "TheFirstDefier, JF Brink", narrator: "Pavi Proczko", release_date: "2021-08-10" },
  { id: "B09KS8RRCT", title: "Defiance of the Fall 3", series_id: "defiance-of-the-fall", series_number: 3, author: "TheFirstDefier, JF Brink", narrator: "Pavi Proczko", release_date: "2021-11-30" },
  { id: "B09SFRKK3V", title: "Defiance of the Fall 4", series_id: "defiance-of-the-fall", series_number: 4, author: "TheFirstDefier, JF Brink", narrator: "Pavi Proczko", release_date: "2022-02-22" },
  { id: "B09YRPQ7KK", title: "Defiance of the Fall 5", series_id: "defiance-of-the-fall", series_number: 5, author: "TheFirstDefier, JF Brink", narrator: "Pavi Proczko", release_date: "2022-05-20" },
  { id: "B0B5KRDBJL", title: "Defiance of the Fall 6", series_id: "defiance-of-the-fall", series_number: 6, author: "TheFirstDefier, JF Brink", narrator: "Pavi Proczko", release_date: "2022-08-16" },
  { id: "B0BFHL5GJ5", title: "Defiance of the Fall 7", series_id: "defiance-of-the-fall", series_number: 7, author: "TheFirstDefier, JF Brink", narrator: "Pavi Proczko", release_date: "2022-10-26" },
  { id: "B0BMXTZH3G", title: "Defiance of the Fall 8", series_id: "defiance-of-the-fall", series_number: 8, author: "TheFirstDefier, JF Brink", narrator: "Pavi Proczko", release_date: "2022-12-30" },
  { id: "B0BZZQC5YT", title: "Defiance of the Fall 9", series_id: "defiance-of-the-fall", series_number: 9, author: "TheFirstDefier, JF Brink", narrator: "Pavi Proczko", release_date: "2023-04-26" },
  { id: "B0C9RTFWX4", title: "Defiance of the Fall 10", series_id: "defiance-of-the-fall", series_number: 10, author: "TheFirstDefier, JF Brink", narrator: "Pavi Proczko", release_date: "2023-08-02" },
  { id: "B0CLMMRQPS", title: "Defiance of the Fall 11", series_id: "defiance-of-the-fall", series_number: 11, author: "TheFirstDefier, JF Brink", narrator: "Pavi Proczko", release_date: "2023-11-15" },
  { id: "B0CVFCFVHH", title: "Defiance of the Fall 12", series_id: "defiance-of-the-fall", series_number: 12, author: "TheFirstDefier, JF Brink", narrator: "Pavi Proczko", release_date: "2024-02-28" },
  { id: "B0D5HN6X6L", title: "Defiance of the Fall 13", series_id: "defiance-of-the-fall", series_number: 13, author: "TheFirstDefier, JF Brink", narrator: "Pavi Proczko", release_date: "2024-06-26" },
  { id: "B0DPH5JJRQ", title: "Defiance of the Fall 14", series_id: "defiance-of-the-fall", series_number: 14, author: "TheFirstDefier, JF Brink", narrator: "Pavi Proczko", release_date: "2024-12-18" },
  { id: "B0F2VCMQGB", title: "Defiance of the Fall 15", series_id: "defiance-of-the-fall", series_number: 15, author: "TheFirstDefier, JF Brink", narrator: "Pavi Proczko", release_date: "2025-07-16" },
  { id: "B0FH5LXNQP", title: "Defiance of the Fall 16", series_id: "defiance-of-the-fall", series_number: 16, author: "TheFirstDefier, JF Brink", narrator: "Pavi Proczko", release_date: "2025-12-23" },

  // He Who Fights with Monsters — Shirtaloon, Travis Deverell, narrated by Heath Miller
  { id: "B08WJ5GBP2", title: "He Who Fights with Monsters", series_id: "he-who-fights-with-monsters", series_number: 1, author: "Shirtaloon, Travis Deverell", narrator: "Heath Miller", release_date: "2021-03-09" },
  { id: "1774249162", title: "He Who Fights with Monsters 2", series_id: "he-who-fights-with-monsters", series_number: 2, author: "Shirtaloon, Travis Deverell", narrator: "Heath Miller", release_date: "2021-05-18" },
  { id: "1039400205", title: "He Who Fights with Monsters 3", series_id: "he-who-fights-with-monsters", series_number: 3, author: "Shirtaloon, Travis Deverell", narrator: "Heath Miller", release_date: "2021-09-07" },
  { id: "B09GHD1R2R", title: "He Who Fights with Monsters 4", series_id: "he-who-fights-with-monsters", series_number: 4, author: "Shirtaloon, Travis Deverell", narrator: "Heath Miller", release_date: "2021-12-28" },
  { id: "B09PSSTFP3", title: "He Who Fights with Monsters 5", series_id: "he-who-fights-with-monsters", series_number: 5, author: "Shirtaloon, Travis Deverell", narrator: "Heath Miller", release_date: "2022-04-05" },
  { id: "B09WB2V33H", title: "He Who Fights with Monsters 6", series_id: "he-who-fights-with-monsters", series_number: 6, author: "Shirtaloon, Travis Deverell", narrator: "Heath Miller", release_date: "2022-06-28" },
  { id: "B0B7JQ1B1H", title: "He Who Fights with Monsters 7", series_id: "he-who-fights-with-monsters", series_number: 7, author: "Shirtaloon, Travis Deverell", narrator: "Heath Miller", release_date: "2022-09-16" },
  { id: "B0BL1R9KQ7", title: "He Who Fights with Monsters 8", series_id: "he-who-fights-with-monsters", series_number: 8, author: "Shirtaloon, Travis Deverell", narrator: "Heath Miller", release_date: "2022-12-13" },
  { id: "B0BMCNHHWN", title: "He Who Fights with Monsters 9", series_id: "he-who-fights-with-monsters", series_number: 9, author: "Shirtaloon, Travis Deverell", narrator: "Heath Miller", release_date: "2023-04-18" },
  { id: "B0CM7N9QYG", title: "He Who Fights with Monsters 10", series_id: "he-who-fights-with-monsters", series_number: 10, author: "Shirtaloon, Travis Deverell", narrator: "Heath Miller", release_date: "2023-11-28" },
  { id: "B0D1DPR1X3", title: "He Who Fights with Monsters 11", series_id: "he-who-fights-with-monsters", series_number: 11, author: "Shirtaloon, Travis Deverell", narrator: "Heath Miller", release_date: "2024-07-23" },
  { id: "B0DWZYWQTB", title: "He Who Fights with Monsters 12", series_id: "he-who-fights-with-monsters", series_number: 12, author: "Shirtaloon, Travis Deverell", narrator: "Heath Miller", release_date: "2025-05-20" },

  // The Path of Ascension — C. Mantis, narrated by J.S. Arquin
  { id: "B0BDGP4LFP", title: "The Path of Ascension", series_id: "the-path-of-ascension", series_number: 1, author: "C. Mantis", narrator: "J.S. Arquin", release_date: "2022-10-04" },
  { id: "B0BS1B2FTH", title: "The Path of Ascension 2", series_id: "the-path-of-ascension", series_number: 2, author: "C. Mantis", narrator: "J.S. Arquin", release_date: "2023-02-07" },
  { id: "B0C1R8Q7FQ", title: "The Path of Ascension 3", series_id: "the-path-of-ascension", series_number: 3, author: "C. Mantis", narrator: "J.S. Arquin", release_date: "2023-05-17" },
  { id: "B0CH5ZK8NS", title: "The Path of Ascension: Books 1-3.5", series_id: "the-path-of-ascension", series_number: 3.5, author: "C. Mantis", narrator: "J.S. Arquin", release_date: "2023-08-23" },
  { id: "B0CK4N9HG5", title: "The Path of Ascension 4", series_id: "the-path-of-ascension", series_number: 4, author: "C. Mantis", narrator: "J.S. Arquin", release_date: "2023-09-27" },
  { id: "B0CWGB2BXN", title: "The Path of Ascension 5", series_id: "the-path-of-ascension", series_number: 5, author: "C. Mantis", narrator: "J.S. Arquin", release_date: "2024-04-09" },
  { id: "B0D3KZLRL6", title: "The Path of Ascension 6", series_id: "the-path-of-ascension", series_number: 6, author: "C. Mantis", narrator: "J.S. Arquin", release_date: "2024-05-22" },
  { id: "B0DBQ82VG8", title: "The Path of Ascension 7", series_id: "the-path-of-ascension", series_number: 7, author: "C. Mantis", narrator: "J.S. Arquin", release_date: "2024-08-21" },
  { id: "B0DRZP3CXR", title: "The Path of Ascension 8", series_id: "the-path-of-ascension", series_number: 8, author: "C. Mantis", narrator: "J.S. Arquin", release_date: "2025-02-05" },
  { id: "B0F4ZPXFCG", title: "The Path of Ascension 9", series_id: "the-path-of-ascension", series_number: 9, author: "C. Mantis", narrator: "J.S. Arquin", release_date: "2025-06-04" },
  { id: "B0FFLZ3WJZ", title: "The Path of Ascension 10", series_id: "the-path-of-ascension", series_number: 10, author: "C. Mantis", narrator: "J.S. Arquin", release_date: "2025-10-28" },
  { id: "B0FPDCR72D", title: "The Path of Ascension Book 10.5", series_id: "the-path-of-ascension", series_number: 10.5, author: "C. Mantis", narrator: "J.S. Arquin", release_date: "2026-01-21" },
  { id: "B0G34CDCP7", title: "The Path of Ascension 11", series_id: "the-path-of-ascension", series_number: 11, author: "C. Mantis", narrator: "J.S. Arquin", release_date: "2026-04-09" },
];

function ensureSeries(db: ReturnType<typeof getDb>, seriesId: string, title: string, author: string) {
  db.prepare(
    `INSERT INTO series (id, title, author) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, author = excluded.author`
  ).run(seriesId, title, author);
}

function main() {
  const db = getDb();

  // Ensure series exist
  ensureSeries(db, "dungeon-crawler-carl", "Dungeon Crawler Carl", "Matt Dinniman");
  ensureSeries(db, "the-primal-hunter", "The Primal Hunter", "Zogarth");
  ensureSeries(db, "defiance-of-the-fall", "Defiance of the Fall", "TheFirstDefier, JF Brink");
  ensureSeries(db, "he-who-fights-with-monsters", "He Who Fights with Monsters", "Shirtaloon, Travis Deverell");
  ensureSeries(db, "the-path-of-ascension", "The Path of Ascension", "C. Mantis");

  // Remove misattributed books from Path of Ascension
  const misattributed = db.prepare(
    `SELECT id, title FROM books WHERE series_id = 'the-path-of-ascension' AND title IN ('Flames of Valor', 'Fire Forged', 'Inferno Rising')`
  ).all() as { id: string; title: string }[];
  for (const book of misattributed) {
    db.prepare(`UPDATE books SET series_id = NULL, series_number = NULL WHERE id = ?`).run(book.id);
    console.log(`  [fix] Removed "${book.title}" from Path of Ascension (misattributed)`);
  }

  let newCount = 0;
  let updatedCount = 0;

  const upsert = db.prepare(`
    INSERT INTO books (id, title, series_id, series_number, author, narrator, release_date, url)
    VALUES (@id, @title, @series_id, @series_number, @author, @narrator, @release_date, @url)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      series_id = excluded.series_id,
      series_number = excluded.series_number,
      author = COALESCE(books.author, excluded.author),
      narrator = COALESCE(books.narrator, excluded.narrator),
      release_date = COALESCE(books.release_date, excluded.release_date),
      updated_at = datetime('now')
  `);

  const existingIds = new Set(
    (db.prepare(`SELECT id FROM books WHERE id IN (${BOOKS.map(() => "?").join(",")})`)
      .all(...BOOKS.map((b) => b.id)) as { id: string }[]).map((r) => r.id)
  );

  for (const book of BOOKS) {
    const isNew = !existingIds.has(book.id);
    upsert.run({
      ...book,
      url: `https://www.audible.com/pd/${book.id}`,
    });

    if (isNew) {
      newCount++;
      console.log(`  [NEW] ${book.series_id} #${book.series_number} — ${book.title}`);
    } else {
      updatedCount++;
    }
  }

  console.log(`\nDone: ${newCount} new, ${updatedCount} updated`);

  // Show final counts
  const series = ["dungeon-crawler-carl", "the-primal-hunter", "defiance-of-the-fall", "he-who-fights-with-monsters", "the-path-of-ascension"];
  for (const sid of series) {
    const count = (db.prepare(`SELECT COUNT(*) as cnt FROM books WHERE series_id = ?`).get(sid) as { cnt: number }).cnt;
    const title = (db.prepare(`SELECT title FROM series WHERE id = ?`).get(sid) as { title: string })?.title;
    console.log(`  ${title}: ${count} books`);
  }

  closeDb();
}

main();
