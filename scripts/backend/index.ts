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
 *   export     Run EXPORT + GUARD stages only
 *   classify   Run CLASSIFY + DETECT + SCORE stages only
 *
 * Options:
 *   --year <n>       Target a specific year
 *   --full           Ignore incremental caches / cursors
 *   --source <name>  Only run one fetcher (e.g. "audible")
 *   --skip-guard     Skip the deploy guard stage
 *   --dry-run        Process data but don't write exports
 *   --help           Show this help message
 */

import { runPipeline, hasCriticalFailure, SUBCOMMAND_STAGES } from './pipeline.js';
import type { PipelineOptions } from './pipeline.js';

function printUsage() {
	console.log(`
Usage: npx tsx scripts/backend/index.ts <command> [options]

Commands:
  build      Run all pipeline stages (default)
  fetch      Run MIGRATE + FETCH stages only
  export     Run EXPORT + GUARD stages only
  classify   Run CLASSIFY + DETECT + SCORE stages only

Options:
  --year <n>       Target a specific year
  --full           Ignore incremental caches / cursors
  --source <name>  Only run one fetcher (e.g. "audible")
  --skip-guard     Skip the deploy guard stage
  --dry-run        Process data but don't write exports
  --help           Show this help message
`.trim());
}

function parseArgs(argv: string[]): { command: string; options: PipelineOptions } {
	const args = argv.slice(2); // skip node + script path
	const options: PipelineOptions = {};
	let command = 'build';

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
			case '--full':
				options.full = true;
				break;
			case '--source':
				options.source = args[++i];
				break;
			case '--skip-guard':
				options.skipGuard = true;
				break;
			case '--dry-run':
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

	return { command, options };
}

async function main() {
	const { command, options } = parseArgs(process.argv);

	const stageRange = SUBCOMMAND_STAGES[command];
	if (!stageRange) {
		console.error(`Unknown command: ${command}`);
		printUsage();
		process.exit(1);
	}

	const result = await runPipeline(options, stageRange);

	if (hasCriticalFailure(result)) {
		process.exit(1);
	}
}

main().catch((err) => {
	console.error('Fatal pipeline error:', err);
	process.exit(1);
});
