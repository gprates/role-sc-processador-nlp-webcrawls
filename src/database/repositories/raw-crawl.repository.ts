import { Collection, Db, ObjectId } from 'mongodb';
import { RawCrawl } from '../../types/raw-crawl.types';

const COLLECTION_NAME = 'raw_crawls';

const getCollection = (db: Db): Collection<RawCrawl> => {
  return db.collection<RawCrawl>(COLLECTION_NAME);
};

export const RawCrawlRepository = {
  findUnprocessed: async (
    db: Db,
    options: { municipality?: string; limit: number },
  ): Promise<RawCrawl[]> => {
    const filter: Record<string, unknown> = { processed: false };

    if (options.municipality) {
      filter.municipality = options.municipality;
    }

    return getCollection(db).find(filter).limit(options.limit).toArray();
  },

  markAsProcessed: async (db: Db, id: ObjectId): Promise<void> => {
    await getCollection(db).updateOne({ _id: id }, { $set: { processed: true } });
  },
};
