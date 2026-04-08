#!/usr/bin/env node
/**
 * CLI entry point for the data backend pipeline.
 *
 * Usage:
 *   npx tsx scripts/backend/index.ts <command> [options]
 *
 * Commands:
 *   build      Run all pipeline stages (default)
 *   fetch      Run MIGRATE + FETCH stages only
 *   export     Run EXPORT stage only
 *   classify   Run CLASSIFY + DETECT + SCORE stages only
 *   backfill   Back-populate historical years (exhaustive fetch)
 *
 * Options:
 *   --year <n>       Target a specific year
 *   --from <n>       Start year for backfill range (use with --to)
 *   --to <n>         End year for backfill range (use with --from)
 *   --all            Backfill all years from 2020 to present
 *   --full           Ignore incremental caches / cursors
 *   --source <name>  Only run one fetcher (e.g. "audible")
 *   --dry-run        Process data but don't write exports
 *   --help           Show this help message
 */

import { runPipeline, runBackfillPipeline, hasCriticalFailure, SUBCOMMAND_STAGES } from './pipeline.js';
import type { PipelineOptions, BackfillOptions } from './pipeline.js';

const BACKFILL_FIRST_YEAR = 2020;

interface ParsedArgs {
	command: string;
	options: PipelineOptions;
	backfillYears?: number[];
	dryRun?: boolean;
}

function printUsage() {
	console.log(`
Usage: npx tsx scripts/backend/index.ts <command> [options]

Commands:
  build      Run all pipeline stages (default)
  fetch      Run MIGRATE + FETCH stages only
  export     Run EXPORT stage only
  classify   Run CLASSIFY + DETECT + SCORE stages only
  backfill   Back-populate historical years (exhaustive fetch)

Options (general):
  --year <n>       Target a specific year
  --full           Ignore incremental caches / cursors
  --source <name>  Only run one fetcher (e.g. "audible")
  --dry-run        Process data but don't write exports
  --help           Show this help message

Options (backfill):
  --year <n>       Backfill a single year
  --from <n>       Start year for range (use with --to)
  --to <n>         End year for range (use with --from)
  --all            Backfill all years from ${BACKFILL_FIRST_YEAR} to present

Examples:
  npx tsx scripts/backend/index.ts backfill --year 2023
  npx tsx scripts/backend/index.ts backfill --from 2020 --to 2024
  npx tsx scripts/backend/index.ts backfill --all
  npx tsx scripts/backend/index.ts backfill --all --dry-run
`.trim());
}

function parseArgs(argv: string[]): ParsedArgs {
	const args = argv.slice(2); // skip node + script path
	const options: PipelineOptions = {};
	let command = 'build';
	let fromYear: number | undefined;
	let toYear: number | undefined;
	let allYears = false;
	let dryRun = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case '--help':
			case '-h':
				printUsage();
				process.exit(0);
				break; // unreachable but satisfies linters
			case '--year':
				options.year = parseInt(args[++i], 10);
				if (isNaN(options.year)) {
					console.error('Error: --year requires a numeric value');
					process.exit(1);
				}
				break;
			case '--from':
				fromYear = parseInt(args[++i], 10);
				if (isNaN(fromYear)) {
					console.error('Error: --from requires a numeric value');
					process.exit(1);
				}
				break;
			case '--to':
				toYear = parseInt(args[++i], 10);
				if (isNaN(toYear)) {
					console.error('Error: --to requires a numeric value');
					process.exit(1);
				}
				break;
			case '--all':
				allYears = true;
				break;
			case '--full':
				options.full = true;
				break;
			case '--source':
				options.source = args[++i];
				break;
			case '--dry-run':
				dryRun = true;
				options.dryRun = true;
				break;
			default:
				if (arg.startsWith('-')) {
					console.error(`Unknown option: ${arg}`);
					printUsage();
					process.exit(1);
				}
				command = arg;
		}
	}

	const parsed: ParsedArgs = { command, options, dryRun };

	// Resolve backfill year range
	if (command === 'backfill') {
		const currentYear = new Date().getFullYear();

		if (allYears) {
			parsed.backfillYears = [];
			for (let y = BACKFILL_FIRST_YEAR; y <= currentYear; y++) {
				parsed.backfillYears.push(y);
			}
		} else if (fromYear != null && toYear != null) {
			if (fromYear > toYear) {
				console.error(`Error: --from (${fromYear}) must be <= --to (${toYear})`);
				process.exit(1);
			}
			parsed.backfillYears = [];
			for (let y = fromYear; y <= toYear; y++) {
				parsed.backfillYears.push(y);
			}
		} else if (options.year != null) {
			parsed.backfillYears = [options.year];
		} else {
			console.error('Error: backfill requires --year, --from/--to, or --all');
			printUsage();
			process.exit(1);
		}
	}

	return parsed;
}

async function main() {
	const parsed = parseArgs(process.argv);

	// Handle backfill subcommand separately
	if (parsed.command === 'backfill') {
		const backfillOpts: BackfillOptions = {
			years: parsed.backfillYears!,
			dryRun: parsed.dryRun,
		};

		const result = await runBackfillPipeline(backfillOpts);

		if (hasCriticalFailure(result)) {
			process.exit(1);
		}
		return;
	}

	// Standard pipeline subcommands
	const stageRange = SUBCOMMAND_STAGES[parsed.command];
	if (!stageRange) {
		console.error(`Unknown command: ${parsed.command}`);
		printUsage();
		process.exit(1);
	}

	const result = await runPipeline(parsed.options, stageRange);

	if (hasCriticalFailure(result)) {
		process.exit(1);
	}
}

main().catch((err) => {
	console.error('Fatal pipeline error:', err);
	process.exit(1);
});
