import { Collection, Db } from 'mongodb';
import { Evento, EventoInsert } from '../../types/evento.types';
import { createLogger } from '../../utils/logger.utils';

const logger = createLogger('EventoRepository');

const COLLECTION_NAME = 'eventos';

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

  ensureIndexes: async (db: Db): Promise<void> => {
    const collection = getCollection(db);
    await collection.createIndex({ url: 1 }, { unique: true });
    await collection.createIndex({ municipio: 1, isEvent: 1 });
    await collection.createIndex({ dataInicio: 1 });
    logger.info('Índices da coleção eventos garantidos');
  },
};
