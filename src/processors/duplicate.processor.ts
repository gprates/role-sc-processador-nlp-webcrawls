import { callGroq } from '../groq/groq.client';
import { Evento } from '../types/evento.types';
import { createLogger } from '../utils/logger.utils';

const logger = createLogger('DuplicateProcessor');

const SYSTEM_PROMPT = `Você verifica se um evento extraído de uma notícia de prefeitura de Santa Catarina, Brasil, já está cadastrado.

## Sua tarefa

Você recebe um EVENTO NOVO e uma lista de EVENTOS CADASTRADOS do mesmo município, em datas que coincidem com a do evento novo. As prefeituras costumam publicar mais de uma notícia sobre o mesmo evento (por exemplo, um anúncio com antecedência e um lembrete na véspera), com títulos e textos diferentes. Diga se o evento novo é o MESMO evento de algum dos cadastrados.

## Regras

1. É o mesmo evento quando se trata da mesma ocorrência: a mesma atividade ou programa, na mesma data e no mesmo local, ainda que título, descrição e endereço estejam escritos de outra forma (ex.: "Meia Praia recebe Prefeitura Mais Perto neste sábado" e "Prefeitura Mais Perto leva serviços gratuitos à Meia Praia em outubro", ambos no dia 17/10 na EMEB Educar)
2. NÃO é o mesmo evento quando são atividades diferentes, mesmo que no mesmo dia ou no mesmo local (ex.: uma feira de artesanato e um show na mesma praça)
3. NÃO é o mesmo evento quando é outra edição ou outra etapa de um evento recorrente, em outra data
4. Na dúvida, responda null: é melhor exibir um evento repetido do que esconder um evento diferente

## Formato de resposta (JSON)

{
  "duplicadoDe": number | null
}

duplicadoDe é o número do evento cadastrado que corresponde ao evento novo, ou null se nenhum corresponder.

Responda APENAS com o JSON válido, sem explicações ou texto adicional.`;

type DadosComparados = Pick<
  Evento,
  'titulo' | 'descricao' | 'dataInicio' | 'dataFim' | 'horario' | 'local'
>;

// As datas são gravadas à meia-noite no fuso do processo, então são lidas no mesmo fuso.
const formatDate = (date: Date | null): string | null => {
  if (!date) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const toPromptData = (evento: DadosComparados) => ({
  titulo: evento.titulo,
  descricao: evento.descricao,
  dataInicio: formatDate(evento.dataInicio),
  dataFim: formatDate(evento.dataFim),
  horario: evento.horario,
  local: evento.local,
});

/**
 * Pergunta ao LLM se o evento novo é o mesmo de algum dos candidatos (eventos já
 * cadastrados no mesmo município, em datas que se sobrepõem). Sem candidatos, não chama o LLM.
 */
export const findDuplicate = async (
  evento: DadosComparados,
  candidatos: Evento[],
): Promise<Evento | null> => {
  if (candidatos.length === 0) return null;

  const userContent = JSON.stringify(
    {
      eventoNovo: toPromptData(evento),
      eventosCadastrados: candidatos.map((candidato, i) => ({
        numero: i + 1,
        ...toPromptData(candidato),
      })),
    },
    null,
    2,
  );

  const responseContent = await callGroq(SYSTEM_PROMPT, userContent);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(responseContent);
  } catch {
    logger.error('Falha ao parsear JSON da resposta do Groq', { response: responseContent });
    throw new Error('Resposta do Groq não é um JSON válido');
  }

  const numero = parsed.duplicadoDe;
  if (numero === null || numero === undefined) return null;

  const isValid =
    typeof numero === 'number' &&
    Number.isInteger(numero) &&
    numero >= 1 &&
    numero <= candidatos.length;

  if (!isValid) {
    logger.warn('Resposta do Groq com número de evento inválido, tratando como não duplicado', {
      response: responseContent,
    });
    return null;
  }

  return candidatos[numero - 1];
};
