import { ObjectId } from 'mongodb';

export interface RawCrawl {
  _id?: ObjectId;
  site: string;
  municipality: string;
  url: string;
  title: string;
  rawText: string;
  imageUrl: string | null;
  publishedAt: string;
  crawledAt: Date;
  processed: boolean;
}
