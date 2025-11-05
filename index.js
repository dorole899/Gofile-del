#!/usr/bin/env node

const { Command } = require('commander');
const GofileGenerator = require('./gofileGenerator');

const program = new Command();

program
  .name('gofile-link-generator')
  .description('Generate, validate, and save valid Gofile links')
  .version('1.0.0');

program
  .option('-c, --continuous', 'Run continuously until Ctrl+C (default behavior)')
  .option('-o, --output <file>', 'Custom output file', 'valid_codes.txt')
  .option('-d, --delay <ms>', 'Delay between requests in milliseconds', '1000')
  .option('-v, --verbose', 'Show detailed progress information')
  .option('-h, --help', 'Show help message')
  .action(async (options) => {
    try {
      // Parse delay as integer
      const delay = parseInt(options.delay) || 1000;

      // Validate delay
      if (delay < 100) {
        console.error('Error: Delay must be at least 100ms to avoid rate limiting');
        process.exit(1);
      }

      const generator = new GofileGenerator({
        outputFile: options.output,
        delay: delay,
        verbose: options.verbose || false
      });

      await generator.startSearching();

    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse();

// If no arguments provided, start with defaults
if (process.argv.length <= 2) {
  console.log('Starting Gofile link generator with default settings...');
  console.log('Use --help for available options\n');

  const generator = new GofileGenerator({
    outputFile: 'valid_codes.txt',
    delay: 1000,
    verbose: false
  });

  generator.startSearching().catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}