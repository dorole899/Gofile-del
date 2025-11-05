const axios = require('axios');
const fs = require('fs');
const path = require('path');

class GofileGenerator {
  constructor(options = {}) {
    this.delay = options.delay || 1000;
    this.outputFile = options.outputFile || 'valid_codes.txt';
    this.verbose = options.verbose || false;
    this.stats = {
      tried: 0,
      valid: 0,
      invalid: 0,
      errors: 0
    };
    this.existingCodes = new Set();
    this.isRunning = false;
  }

  // Generate random Gofile code (6 characters, A-Z and 0-9)
  generateRandomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // Format file size with appropriate unit
  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return 'Unknown';

    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  // Validate a Gofile code via API
  async validateCode(code) {
    const url = `https://api.gofile.io/getFile/${code}`;
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        const response = await axios.get(url, {
          timeout: 10000,
          validateStatus: (status) => status < 500 // Don't retry for 4xx errors
        });

        if (response.status === 200 && response.data.status === 'success') {
          const fileData = response.data.data;
          return {
            valid: true,
            code: code,
            url: `https://gofile.io/d/${code}`,
            filename: fileData.name || 'Unknown',
            size: this.formatFileSize(fileData.size),
            downloads: fileData.downloads || 0
          };
        } else {
          return {
            valid: false,
            code: code,
            reason: response.data.data?.message || 'File not found'
          };
        }
      } catch (error) {
        retryCount++;

        if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
          if (retryCount >= maxRetries) {
            throw new Error('Network connection failed');
          }
          await this.sleep(5000 * retryCount); // Exponential backoff
        } else if (error.response?.status === 429) {
          if (this.verbose) {
            console.log('Rate limited, waiting 60 seconds...');
          }
          await this.sleep(60000);
        } else if (error.response?.status === 404 ||
                   (error.response?.data?.status === 'error')) {
          // File not found, don't retry
          return {
            valid: false,
            code: code,
            reason: 'File not found'
          };
        } else {
          // Other error, retry
          if (retryCount >= maxRetries) {
            throw error;
          }
          await this.sleep(2000 * retryCount);
        }
      }
    }

    return {
      valid: false,
      code: code,
      reason: 'Max retries exceeded'
    };
  }

  // Load existing codes from output file to prevent duplicates
  loadExistingCodes() {
    try {
      if (fs.existsSync(this.outputFile)) {
        const content = fs.readFileSync(this.outputFile, 'utf8');
        const lines = content.split('\n').filter(line =>
          line && !line.startsWith('#') // Skip comments and empty lines
        );

        lines.forEach(line => {
          const code = line.split(' | ')[0]; // Extract URL part
          if (code && code.includes('/d/')) {
            const extractedCode = code.split('/d/')[1];
            this.existingCodes.add(extractedCode);
          }
        });

        if (this.verbose) {
          console.log(`Loaded ${this.existingCodes.size} existing codes from ${this.outputFile}`);
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not read existing codes file: ${error.message}`);
    }
  }

  // Save valid code to output file
  async saveValidCode(fileInfo) {
    try {
      const line = `${fileInfo.url} | ${fileInfo.filename} | ${fileInfo.size} | ${fileInfo.downloads} downloads\n`;

      // Add header timestamp if file is new
      let header = '';
      if (!fs.existsSync(this.outputFile)) {
        header = `# Generated on: ${new Date().toISOString()}\n`;
      }

      fs.writeFileSync(this.outputFile, header + line, { flag: 'a' });
      this.existingCodes.add(fileInfo.code);

      if (this.verbose) {
        console.log(`Saved: ${fileInfo.url}`);
      }
    } catch (error) {
      console.error(`Error saving to file: ${error.message}`);
      // Try to create backup in current directory
      try {
        const backupFile = `backup_${Date.now()}_${this.outputFile}`;
        fs.writeFileSync(backupFile, `${fileInfo.url} | ${fileInfo.filename} | ${fileInfo.size} | ${fileInfo.downloads} downloads\n`);
        console.log(`Saved to backup file: ${backupFile}`);
      } catch (backupError) {
        console.error(`Failed to create backup: ${backupError.message}`);
      }
    }
  }

  // Sleep helper function
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Main search loop
  async startSearching() {
    this.isRunning = true;
    this.loadExistingCodes();

    console.log('Searching for valid Gofile codes...');
    console.log('Press Ctrl+C to stop\n');

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      this.stopSearching();
    });

    while (this.isRunning) {
      try {
        const code = this.generateRandomCode();

        // Skip if we already have this code
        if (this.existingCodes.has(code)) {
          continue;
        }

        this.stats.tried++;
        process.stdout.write(`[${this.stats.tried}] Trying: ${code} - `);

        const result = await this.validateCode(code);

        if (result.valid) {
          this.stats.valid++;
          console.log(`Valid! Found: ${result.filename} (${result.size}, ${result.downloads} downloads)`);
          await this.saveValidCode(result);
        } else {
          this.stats.invalid++;
          console.log(`Invalid (${result.reason})`);
        }

        // Show statistics every 50 attempts
        if (this.stats.tried % 50 === 0) {
          const successRate = ((this.stats.valid / this.stats.tried) * 100).toFixed(2);
          console.log(`\nStatistics: ${this.stats.valid} valid codes found from ${this.stats.tried} attempts (${successRate}% success rate)\n`);
        }

        // Rate limiting
        if (this.isRunning) {
          await this.sleep(this.delay);
        }

      } catch (error) {
        this.stats.errors++;
        console.error(`Error: ${error.message}`);

        if (error.message.includes('Network connection failed')) {
          console.error('Network connection failed. Please check your internet connection.');
          this.stopSearching();
          break;
        }

        // Continue after error
        await this.sleep(5000);
      }
    }
  }

  // Stop searching and show summary
  stopSearching() {
    if (this.isRunning) {
      this.isRunning = false;
      console.log('\nSearch stopped by user');
      console.log(`Total codes tried: ${this.stats.tried}`);
      console.log(`Valid codes found: ${this.stats.valid}`);
      console.log(`Invalid codes: ${this.stats.invalid}`);
      console.log(`Errors: ${this.stats.errors}`);

      if (this.stats.tried > 0) {
        const successRate = ((this.stats.valid / this.stats.tried) * 100).toFixed(2);
        console.log(`Success rate: ${successRate}%`);
      }

      console.log(`Results saved to: ${this.outputFile}`);

      process.exit(0);
    }
  }
}

module.exports = GofileGenerator;