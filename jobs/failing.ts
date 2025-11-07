import { JobDefinition } from '../src/types';

const definition: JobDefinition = {
  key: 'failing',
  version: 1,
  defaultMaxAttempts: 3,
  run: async (params, ctx) => {
    ctx.logger.info('Failing job started');
    throw new Error('Intentional failure');
  },
};

export default definition;

