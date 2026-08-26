import Groq from 'groq-sdk';
import { createLogger } from '../utils/logger.utils';

const logger = createLogger('GroqClient');

const DEFAULT_MODEL = 'openai/gpt-oss-20b';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5_000;

let client: Groq | null = null;

const getClient = (): Groq => {
  if (!client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY não definida nas variáveis de ambiente');
    client = new Groq({ apiKey });
  }
  return client;
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const callGroq = async (systemPrompt: string, userContent: string): Promise<string> => {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const response = await getClient().chat.completions.create({
        model: process.env.GROQ_MODEL || DEFAULT_MODEL,
        response_format: { type: 'json_object' },
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('Resposta vazia do Groq');

      return content;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const isRateLimit =
        error instanceof Error && 'status' in error && (error as { status: number }).status === 429;

      if (isRateLimit && attempt <= MAX_RETRIES) {
        logger.warn(`Rate limit atingido, tentativa ${attempt}/${MAX_RETRIES + 1}. Aguardando...`);
        await delay(RETRY_DELAY_MS * attempt);
        continue;
      }

      throw lastError;
    }
  }

  throw lastError;
};
