import 'dotenv/config';

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function runCommand(command: string, description: string): Promise<boolean> {
  return new Promise((resolve) => {
    log(`\n${'='.repeat(70)}`, colors.blue);
    log(`Running: ${description}`, colors.cyan);
    log('='.repeat(70), colors.blue);
    
    const { spawn } = require('child_process');
    const [cmd, ...args] = command.split(' ');
    const proc = spawn('npm', ['run', cmd, ...args], {
      stdio: 'inherit',
      shell: true,
    });
    
    proc.on('close', (code: number) => {
      if (code === 0) {
        log(`\n✓ ${description} completed successfully`, colors.green);
        resolve(true);
      } else {
        log(`\n✗ ${description} failed with exit code ${code}`, colors.red);
        resolve(false);
      }
    });
    
    proc.on('error', (error: Error) => {
      log(`\n✗ Error running ${description}: ${error.message}`, colors.red);
      resolve(false);
    });
  });
}

async function main() {
  log('\n' + '='.repeat(70), colors.blue);
  log('  COMPREHENSIVE TEST SUITE RUNNER', colors.blue);
  log('='.repeat(70), colors.blue);
  
  const results: { name: string; passed: boolean }[] = [];
  
  // Run end-to-end tests
  const e2ePassed = await runCommand('test:e2e', 'End-to-End Tests');
  results.push({ name: 'End-to-End Tests', passed: e2ePassed });
  
  // Run edge case tests
  const edgeCasesPassed = await runCommand('test:edge-cases', 'Edge Case Tests');
  results.push({ name: 'Edge Case Tests', passed: edgeCasesPassed });
  
  // Print final summary
  log('\n' + '='.repeat(70), colors.blue);
  log('  FINAL TEST SUMMARY', colors.blue);
  log('='.repeat(70), colors.blue);
  
  results.forEach((result) => {
    const status = result.passed ? '✓ PASS' : '✗ FAIL';
    const color = result.passed ? colors.green : colors.red;
    log(`${result.name}: ${status}`, color);
  });
  
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  
  log(`\nTotal: ${passed}/${total} test suites passed`, passed === total ? colors.green : colors.yellow);
  
  if (passed === total) {
    log('\n🎉 All test suites passed!', colors.green);
    process.exit(0);
  } else {
    log('\n⚠ Some test suites failed', colors.yellow);
    process.exit(1);
  }
}

main().catch((error) => {
  log(`\n✗ Fatal error: ${error}`, colors.red);
  process.exit(1);
});

