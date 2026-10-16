import { Collection, Db } from 'mongodb';
import { Evento, EventoInsert } from '../../types/evento.types';
import { createLogger } from '../../utils/logger.utils';

const logger = createLogger('EventoRepository');

const COLLECTION_NAME = 'eventos';
const MAX_DUPLICATE_CANDIDATES = 20;

const getCollection = (db: Db): Collection<Evento> => {
  return db.collection<Evento>(COLLECTION_NAME);
};

export const EventoRepository = {
  save: async (db: Db, evento: EventoInsert): Promise<boolean> => {
    try {
      await getCollection(db).insertOne(evento as Evento);
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as { code: number }).code === 11000) {
        logger.warn('Evento duplicado (URL já existe), pulando', { url: evento.url });
        return false;
      }
      throw error;
    }
  },

  /**
   * Eventos do município cujo período (dataInicio até dataFim, ou só dataInicio) se sobrepõe
   * ao informado. São os candidatos a duplicata de um evento novo.
   */
  findOverlapping: async (
    db: Db,
    filtro: { municipio: string; dataInicio: Date; dataFim: Date | null },
  ): Promise<Evento[]> => {
    const inicio = filtro.dataInicio;
    const fim = filtro.dataFim ?? filtro.dataInicio;

    return getCollection(db)
      .find({
        municipio: filtro.municipio,
        isEvent: true,
        dataInicio: { $lte: fim },
        $or: [{ dataFim: { $gte: inicio } }, { dataFim: null, dataInicio: { $gte: inicio } }],
      })
      .limit(MAX_DUPLICATE_CANDIDATES)
      .toArray();
  },

  ensureIndexes: async (db: Db): Promise<void> => {
    const collection = getCollection(db);
    await collection.createIndex({ url: 1 }, { unique: true });
    await collection.createIndex({ municipio: 1, isEvent: 1 });
    await collection.createIndex({ dataInicio: 1 });
    logger.info('Índices da coleção eventos garantidos');
  },
};
