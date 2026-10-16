import { connectToDatabase, closeDatabaseConnection } from './database/mongodb.connection';
import { RawCrawlRepository } from './database/repositories/raw-crawl.repository';
import { EventoRepository } from './database/repositories/evento.repository';
import { processEvent } from './processors/event.processor';
import { findDuplicate } from './processors/duplicate.processor';
import { EventoInsert } from './types/evento.types';
import { ProcessingResult } from './types/lambda.types';
import { createLogger } from './utils/logger.utils';

const logger = createLogger('Runner');

const DELAY_BETWEEN_CALLS_MS = 2_500;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface RunOptions {
  municipality?: string;
  batchSize?: number;
}

export const run = async (options: RunOptions = {}): Promise<ProcessingResult> => {
  const { municipality, batchSize = 50 } = options;
  const startTime = Date.now();

  let processed = 0;
  let saved = 0;
  let skipped = 0;
  let duplicates = 0;
  let errors = 0;

  const db = await connectToDatabase();
  await EventoRepository.ensureIndexes(db);

  const filter = municipality ? `município: ${municipality}` : 'todos os municípios';
  logger.info(`Buscando raw_crawls não processados (${filter}, limite: ${batchSize})`);

  const rawCrawls = await RawCrawlRepository.findUnprocessed(db, {
    municipality,
    limit: batchSize,
  });

  logger.info(`Encontrados ${rawCrawls.length} documentos para processar`);

  for (let i = 0; i < rawCrawls.length; i++) {
    const rawCrawl = rawCrawls[i];

    try {
      logger.info(`Processando [${i + 1}/${rawCrawls.length}]: ${rawCrawl.title}`, {
        url: rawCrawl.url,
      });

      const result = await processEvent(rawCrawl.rawText);

      const evento: EventoInsert = {
        titulo: result.titulo ?? rawCrawl.title,
        descricao: result.descricao,
        dataInicio: result.dataInicio,
        dataFim: result.dataFim,
        horario: result.horario,
        local: result.local,
        categoria: result.categoria,
        isEvent: result.isEvent,
        municipio: rawCrawl.municipality,
        site: rawCrawl.site,
        url: rawCrawl.url,
        imageUrl: rawCrawl.imageUrl ?? null,
        publishedAt: rawCrawl.publishedAt,
        processedAt: new Date(),
        rawCrawlId: rawCrawl._id!,
        duplicateOf: null,
      };

      // Só procura duplicata de evento com data: os candidatos são eventos do mesmo município em datas sobrepostas.
      const candidatos =
        evento.isEvent && evento.dataInicio
          ? await EventoRepository.findOverlapping(db, {
              municipio: evento.municipio,
              dataInicio: evento.dataInicio,
              dataFim: evento.dataFim,
            })
          : [];
      const original = await findDuplicate(evento, candidatos);

      if (original) {
        // A duplicata é gravada como não-evento, para não aparecer na API, mas mantém os dados extraídos.
        evento.isEvent = false;
        evento.duplicateOf = original._id!;
      }

      const wasSaved = await EventoRepository.save(db, evento);
      wasSaved ? saved++ : skipped++;
      if (wasSaved && original) duplicates++;

      await RawCrawlRepository.markAsProcessed(db, rawCrawl._id!);
      processed++;

      if (original) {
        logger.info('Resultado: DUPLICADO', {
          titulo: evento.titulo,
          duplicateOf: original._id?.toString(),
          tituloOriginal: original.titulo,
        });
      } else {
        const status = result.isEvent ? 'EVENTO' : 'NÃO-EVENTO';
        logger.info(`Resultado: ${status}`, {
          titulo: evento.titulo,
          categoria: evento.categoria,
        });
      }

      if (i < rawCrawls.length - 1) {
        await delay(DELAY_BETWEEN_CALLS_MS);
      }
    } catch (error) {
      errors++;
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Erro ao processar: ${rawCrawl.title}`, { url: rawCrawl.url, error: message });
    }
  }

  await closeDatabaseConnection();

  const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);

  logger.info('Processamento concluído', {
    processed,
    saved,
    skipped,
    duplicates,
    errors,
    elapsedSeconds,
  });

  return { processed, saved, skipped, duplicates, errors, elapsedSeconds };
};
