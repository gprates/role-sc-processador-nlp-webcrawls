import { ObjectId } from 'mongodb';

export interface Evento {
  _id?: ObjectId;
  titulo: string;
  descricao: string | null;
  dataInicio: Date | null;
  dataFim: Date | null;
  horario: string | null;
  local: string | null;
  categoria: string | null;
  isEvent: boolean;
  municipio: string;
  site: string;
  url: string;
  imageUrl: string | null;
  publishedAt: string;
  processedAt: Date;
  rawCrawlId: ObjectId;
}

export type EventoInsert = Omit<Evento, '_id'>;

export interface GroqExtractedEvent {
  isEvent: boolean;
  titulo: string | null;
  descricao: string | null;
  dataInicio: string | null;
  dataFim: string | null;
  horario: string | null;
  local: string | null;
  categoria: string | null;
}

export const CATEGORIAS_VALIDAS = [
  'Cultura',
  'Esporte',
  'Gastronomia',
  'Educação',
  'Saúde',
  'Meio Ambiente',
  'Turismo',
  'Religião',
  'Outro',
] as const;

export type Categoria = (typeof CATEGORIAS_VALIDAS)[number];
