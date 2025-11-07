import { JobDefinition } from '../src/types';

const definition: JobDefinition = {
  key: 'compute.math',
  version: 1,
  defaultMaxAttempts: 3,
  run: async (params, ctx) => {
    const { operation, numbers } = params as { operation: string; numbers: number[] };
    ctx.logger.info('Math computation started', { operation, numbers });
    
    let result: number;
    
    switch (operation) {
      case 'sum':
        result = numbers.reduce((a, b) => a + b, 0);
        break;
      case 'product':
        result = numbers.reduce((a, b) => a * b, 1);
        break;
      case 'fibonacci':
        // Compute nth Fibonacci number (CPU-intensive)
        const n = numbers[0] || 30;
        const fib = (n: number): number => {
          if (n <= 1) return n;
          return fib(n - 1) + fib(n - 2);
        };
        result = fib(n);
        break;
      case 'prime':
        // Check if number is prime (CPU-intensive)
        const num = numbers[0] || 1000000;
        const isPrime = (n: number): boolean => {
          if (n < 2) return false;
          for (let i = 2; i * i <= n; i++) {
            if (n % i === 0) return false;
          }
          return true;
        };
        result = isPrime(num) ? 1 : 0;
        break;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
    
    ctx.logger.info('Math computation completed', { operation, result });
    await ctx.emitEvent('result', { operation, result, input: numbers });
  },
};

export default definition;

