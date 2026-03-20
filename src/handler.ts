import { LambdaEvent, LambdaResponse } from './types/lambda.types';
import { run } from './runner';
import { createLogger } from './utils/logger.utils';

const logger = createLogger('Handler');

export const handler = async (event: LambdaEvent): Promise<LambdaResponse> => {
  const { municipality, batchSize } = event ?? {};

  logger.info('Lambda iniciada', { municipality, batchSize });

  try {
    const result = await run({ municipality, batchSize });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, ...result }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Erro fatal na execução', { error: message });

    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: message }),
    };
  }
};
