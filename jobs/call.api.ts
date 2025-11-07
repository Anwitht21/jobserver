import { JobDefinition } from '../src/types';

const definition: JobDefinition = {
  key: 'call.api',
  version: 1,
  defaultMaxAttempts: 3,
  timeoutSeconds: 300, // 5 minutes
  run: async (params, ctx) => {
    const { endpoint, method, payload } = params as { 
      endpoint: string; 
      method?: string; 
      payload?: Record<string, unknown> 
    };
    ctx.logger.info('API call started', { endpoint, method: method || 'GET' });
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Simulate API response
    const response = {
      status: 200,
      data: { message: 'API call successful', endpoint, timestamp: new Date().toISOString() },
    };
    
    ctx.logger.info('API call completed', { endpoint, status: response.status });
    await ctx.emitEvent('api_response', response);
  },
  onFail: async (ctx) => {
    ctx.logger.error('API call failed - may need to retry', { error: ctx.error });
  },
};

export default definition;

