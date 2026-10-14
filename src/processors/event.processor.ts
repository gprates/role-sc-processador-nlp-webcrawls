import { callGroq } from '../groq/groq.client';
import { GroqExtractedEvent, CATEGORIAS_VALIDAS } from '../types/evento.types';
import { createLogger } from '../utils/logger.utils';

const logger = createLogger('EventProcessor');

const buildSystemPrompt = (): string => {
  const currentYear = new Date().getFullYear();

  return `Você é um extrator especializado em identificar e estruturar informações sobre eventos a partir de textos de sites de prefeituras de Santa Catarina, Brasil.

## Sua tarefa

Analise o texto fornecido e determine se ele descreve um EVENTO — algo que acontece em um local e horário específicos, onde pessoas podem comparecer (exemplos: festival, show, exposição, feira, workshop, palestra, cerimônia, competição esportiva, mutirão comunitário).

NÃO são eventos: notícias sobre obras públicas, licitações, decretos, contratações, ações administrativas, balanços, prestações de contas, comunicados internos, inaugurações de infraestrutura sem programação aberta ao público.

## Regras de extração

1. Se o texto descreve um evento, extraia as informações disponíveis
2. Se NÃO descreve um evento, retorne isEvent como false e null em todos os outros campos
3. Se o texto mencionar múltiplos eventos, extraia o PRINCIPAL (o foco da notícia)
4. Datas devem ser convertidas para o formato YYYY-MM-DD (ex: "14 de março de 2026" → "2026-03-14", "14/03/2026" → "2026-03-14")
5. Se o ano não for mencionado, assuma ${currentYear}
6. dataFim só deve ser preenchido se o evento durar MAIS de um dia
7. A descrição deve ser um resumo curto (1-3 frases próprias), NÃO copie o texto inteiro
8. horario deve manter o formato original do texto (ex: "19h", "10h às 22h", "a partir das 14h")
9. local deve incluir o nome do espaço e endereço se disponível
10. categoria deve ser EXATAMENTE uma das opções: "Cultura", "Esporte", "Gastronomia", "Educação", "Saúde", "Meio Ambiente", "Turismo", "Religião", "Outro"
11. O idioma do texto é português, então a descrição do evento deve ser em português, mesmo que o texto original esteja em outro idioma.

## Formato de resposta (JSON)

{
  "isEvent": boolean,
  "titulo": string | null,
  "descricao": string | null,
  "dataInicio": "YYYY-MM-DD" | null,
  "dataFim": "YYYY-MM-DD" | null,
  "horario": string | null,
  "local": string | null,
  "categoria": "Cultura" | "Esporte" | "Gastronomia" | "Educação" | "Saúde" | "Meio Ambiente" | "Turismo" | "Religião" | "Outro" | null
}

Se isEvent for false, TODOS os outros campos devem ser null.

Responda APENAS com o JSON válido, sem explicações ou texto adicional.`;
};

const parseDate = (dateStr: string | null): Date | null => {
  if (!dateStr) return null;
  const date = new Date(dateStr + 'T00:00:00');
  return isNaN(date.getTime()) ? null : date;
};

const validateCategoria = (categoria: string | null): string | null => {
  if (!categoria) return null;
  const found = CATEGORIAS_VALIDAS.find(
    (c) => c.toLowerCase() === categoria.toLowerCase(),
  );
  return found ?? 'Outro';
};

const validateExtraction = (raw: Record<string, unknown>): GroqExtractedEvent => {
  const isEvent = Boolean(raw.isEvent);

  if (!isEvent) {
    return {
      isEvent: false,
      titulo: null,
      descricao: null,
      dataInicio: null,
      dataFim: null,
      horario: null,
      local: null,
      categoria: null,
    };
  }

  return {
    isEvent: true,
    titulo: typeof raw.titulo === 'string' ? raw.titulo : null,
    descricao: typeof raw.descricao === 'string' ? raw.descricao : null,
    dataInicio: typeof raw.dataInicio === 'string' ? raw.dataInicio : null,
    dataFim: typeof raw.dataFim === 'string' ? raw.dataFim : null,
    horario: typeof raw.horario === 'string' ? raw.horario : null,
    local: typeof raw.local === 'string' ? raw.local : null,
    categoria: typeof raw.categoria === 'string' ? raw.categoria : null,
  };
};

export interface ProcessedEvent {
  isEvent: boolean;
  titulo: string | null;
  descricao: string | null;
  dataInicio: Date | null;
  dataFim: Date | null;
  horario: string | null;
  local: string | null;
  categoria: string | null;
}

export const processEvent = async (rawText: string): Promise<ProcessedEvent> => {
  const systemPrompt = buildSystemPrompt();
  const responseContent = await callGroq(systemPrompt, rawText);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(responseContent);
  } catch {
    logger.error('Falha ao parsear JSON da resposta do Groq', { response: responseContent });
    throw new Error('Resposta do Groq não é um JSON válido');
  }

  const extracted = validateExtraction(parsed);

  return {
    isEvent: extracted.isEvent,
    titulo: extracted.titulo,
    descricao: extracted.descricao,
    dataInicio: parseDate(extracted.dataInicio),
    dataFim: parseDate(extracted.dataFim),
    horario: extracted.horario,
    local: extracted.local,
    categoria: validateCategoria(extracted.categoria),
  };
};
