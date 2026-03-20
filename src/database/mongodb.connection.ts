import { MongoClient, Db } from 'mongodb';
import { createLogger } from '../utils/logger.utils';

const logger = createLogger('MongoDB');

let client: MongoClient | null = null;

const getConnectionUri = (): string => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI não definida nas variáveis de ambiente');
  return uri;
};

const getDbName = (): string => {
  const name = process.env.MONGODB_DB_NAME;
  if (!name) throw new Error('MONGODB_DB_NAME não definida nas variáveis de ambiente');
  return name;
};

export const connectToDatabase = async (): Promise<Db> => {
  if (!client) {
    logger.info('Conectando ao MongoDB...');
    client = new MongoClient(getConnectionUri());
    await client.connect();
    logger.info('Conexão estabelecida');
  }

  return client.db(getDbName());
};

export const closeDatabaseConnection = async (): Promise<void> => {
  if (client) {
    await client.close();
    client = null;
    logger.info('Conexão encerrada');
  }
};
