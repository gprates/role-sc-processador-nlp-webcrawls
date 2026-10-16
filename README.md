# Rolê SC: processador NLP dos web crawls

Função AWS Lambda do sistema Rolê SC que transforma as publicações cruas coletadas dos sites das prefeituras em eventos estruturados. Ela lê a coleção `raw_crawls` (gravada pelo `role-sc-webcrawler`), pede a um LLM da [Groq](https://groq.com) que diga se cada texto descreve um evento e extraia seus dados, e grava o resultado na coleção `eventos` (lida pela `role-sc-api`, que serve o app e o site).

```
role-sc-webcrawler ──> raw_crawls ──> [este processador + Groq] ──> eventos ──> role-sc-api ──> app / site
```

Em produção roda na AWS Lambda, disparada pelo EventBridge Scheduler uma vez por hora, das 8h às 19h (horário de Brasília).

## Como funciona

A cada execução (`src/runner.ts`):

1. Conecta ao MongoDB e garante os índices de `eventos`: `{url: 1}` único, `{municipio: 1, isEvent: 1}` e `{dataInicio: 1}`.
2. Busca até `batchSize` documentos de `raw_crawls` com `processed: false` (padrão 50 na Lambda e 5 no `pnpm invoke`), opcionalmente só de um município.
3. Para cada documento, envia o campo `rawText` ao modelo da Groq (modo JSON, `temperature: 0.1`). O prompt e as regras de extração estão em `src/processors/event.processor.ts`.
4. Valida a resposta e normaliza a categoria.
5. Se é um evento com `dataInicio`, verifica se ele já foi cadastrado a partir de outra notícia (ver **Eventos repetidos** adiante).
6. Grava um documento em `eventos`, inclusive quando o texto não é evento (`isEvent: false`).
7. Marca o documento de origem como `processed: true` e espera 2,5 s antes do próximo.
8. Devolve um resumo: `{processed, saved, skipped, duplicates, errors, elapsedSeconds}`.

Comportamentos importantes:

- **Duplicados**: se já existe evento com a mesma `url`, ele não é gravado de novo (conta em `skipped`), e o `raw_crawl` é marcado como processado.
- **Eventos repetidos**: as prefeituras costumam publicar mais de uma notícia sobre o mesmo evento, com URLs e títulos diferentes (por exemplo, um anúncio e um lembrete na véspera). Para não exibir o evento duas vezes, o processador busca em `eventos` os candidatos: eventos (`isEvent: true`) do mesmo município cujo período (`dataInicio` até `dataFim`) se sobrepõe ao do evento novo, no máximo 20. Se houver algum, faz uma segunda chamada à Groq comparando o evento novo com eles (prompt em `src/processors/duplicate.processor.ts`); sem candidatos, não há chamada extra. Se o LLM apontar um deles, o evento novo é gravado com `isEvent: false` e `duplicateOf` com o `_id` do evento já cadastrado, mantendo os dados extraídos, e conta em `duplicates` (além de `saved`). Assim a API, que só lista `isEvent: true`, não o exibe, sem precisar de mudança. Eventos sem `dataInicio` não são verificados. O primeiro evento gravado é o que fica visível; o repetido não altera os dados dele. Na dúvida, o prompt manda o LLM não marcar como repetido, porque esconder um evento diferente é pior do que exibir um repetido.
- **Falhas**: se o LLM falhar ou devolver JSON inválido, o documento conta em `errors` e continua `processed: false`; ele é tentado de novo na próxima execução. O SDK da Groq repete erros 5xx e 429, e o código repete 429 mais duas vezes (espera de 5 s e 10 s).
- **Município**: o filtro usa o nome de exibição gravado pelo crawler em `municipality` (por exemplo `Camboriú`, `Balneário Camboriú`), não a chave do crawler (`camboriu`).

### Entrada: `raw_crawls`

Campos usados: `_id`, `site`, `municipality`, `url`, `title`, `rawText`, `imageUrl` (ou `null`), `publishedAt` (texto livre) e `processed`. O crawler também grava `crawledAt`, que este processador não lê. Só o `rawText` vai para o LLM.

### Saída: `eventos`

| Campo | Origem |
|---|---|
| `titulo` | LLM; se vier nulo, o `title` do `raw_crawl` |
| `descricao`, `horario`, `local` | LLM (texto ou `null`) |
| `dataInicio`, `dataFim` | LLM no formato `YYYY-MM-DD`, gravados como `Date` à meia-noite no fuso do processo (UTC na Lambda) |
| `categoria` | LLM, normalizada para `Cultura`, `Esporte`, `Gastronomia`, `Educação`, `Saúde`, `Meio Ambiente`, `Turismo`, `Religião` ou `Outro` (valor desconhecido vira `Outro`) |
| `isEvent` | LLM (`false` zera os outros campos extraídos); também `false` quando o evento é repetido |
| `municipio`, `site`, `url`, `imageUrl`, `publishedAt` | copiados do `raw_crawl` (`municipality` vira `municipio`) |
| `processedAt` | data do processamento |
| `rawCrawlId` | `_id` do `raw_crawl` |
| `duplicateOf` | `_id` do evento já cadastrado do qual este é repetição, ou `null` |

### Estrutura

```
src/
  handler.ts            entrypoint da Lambda (evento {municipality?, batchSize?})
  invoke-local.ts       execução local: pnpm invoke [municipio] [batchSize]
  runner.ts             laço de processamento
  groq/groq.client.ts   chamada à Groq (modelo, retry de 429)
  processors/           prompts (extração e eventos repetidos), validação das respostas e conversão de datas
  database/             conexão MongoDB e repositórios de raw_crawls e eventos
  types/                tipos de raw_crawls, eventos e da Lambda
template.yaml           stack AWS SAM (função + agendamento)
Dockerfile              imagem para executar o processamento uma vez
```

## Rodar localmente

Requisitos: Node.js 24, pnpm (testado com 12.5.1), Docker (para o MongoDB local) e uma chave da Groq ou um servidor que a simule (ver adiante).

1. Instale as dependências:

   ```bash
   pnpm install
   ```

   O `pnpm-workspace.yaml` libera o script de instalação do `esbuild`; sem ele, o pnpm 11 ou mais novo termina com `ERR_PNPM_IGNORED_BUILDS`.

2. Suba um MongoDB local:

   ```bash
   docker run -d --name role-sc-mongo -p 27017:27017 mongo:7
   ```

3. Crie o `.env` a partir do exemplo e preencha a `GROQ_API_KEY`:

   ```bash
   cp .env.example .env
   ```

   O `.env.example` já aponta para `mongodb://127.0.0.1:27017` e o banco `role_sc`. O `pnpm invoke` carrega o `.env` automaticamente; variáveis já definidas no ambiente têm precedência.

4. Tenha documentos em `raw_crawls` com `processed: false`, rodando o `role-sc-webcrawler` contra o mesmo banco, ou inserindo um à mão:

   ```bash
   docker exec role-sc-mongo mongosh role_sc --quiet --eval '
   db.raw_crawls.insertOne({
     site: "Camboriú",
     municipality: "Camboriú",
     url: "https://exemplo.local/noticia/festival-de-inverno",
     title: "Festival de Inverno na praça central",
     rawText: "Festival de Inverno na praça central\n\n14 de março de 2026\n\nO festival acontece nos dias 20 e 21 de novembro, a partir das 18h, na Praça das Figueiras.",
     imageUrl: null,
     publishedAt: "14 de março de 2026",
     crawledAt: new Date(),
     processed: false
   })'
   ```

5. Execute:

   ```bash
   pnpm invoke                       # todos os municípios, lote de 5
   pnpm invoke "Camboriú"            # só Camboriú, lote de 5
   pnpm invoke "Camboriú" 20         # só Camboriú, lote de 20
   pnpm invoke "" 20                 # todos os municípios, lote de 20
   ```

   O resultado aparece no fim do log (`Status: 200` e o resumo). Para conferir o que foi gravado:

   ```bash
   docker exec role-sc-mongo mongosh role_sc --quiet --eval 'db.eventos.find().toArray()'
   ```

Verificação de tipos: `pnpm typecheck`. O projeto não tem testes automatizados.

Atenção: o `pnpm invoke` sempre termina com código de saída 0, mesmo quando a execução falha (por exemplo, variável ausente ou banco inacessível). Confira o `Status` e o `success` impressos no fim.

### Sem chave da Groq: servidor simulado

Para testar sem chamar a Groq, defina `GROQ_BASE_URL` com o endereço de um servidor compatível com a API de Chat Completions da OpenAI. O `groq-sdk` envia `POST <GROQ_BASE_URL>/openai/v1/chat/completions` e lê `choices[0].message.content`, que deve ser um texto JSON neste formato:

```json
{
  "isEvent": true,
  "titulo": "Festival de Inverno",
  "descricao": "Resumo curto",
  "dataInicio": "2026-11-20",
  "dataFim": "2026-11-21",
  "horario": "18h",
  "local": "Praça das Figueiras",
  "categoria": "Cultura"
}
```

Quando o evento tem data e há candidatos a repetição (ver **Eventos repetidos**), o processador faz uma segunda chamada, cujo prompt de sistema pede o campo `duplicadoDe`. Nela o conteúdo do usuário é um JSON com `eventoNovo` e `eventosCadastrados` (cada um com `numero`), e a resposta deve ser `{"duplicadoDe": 1}` (o `numero` do evento repetido) ou `{"duplicadoDe": null}`.

Nesse caso a `GROQ_API_KEY` pode ter qualquer valor não vazio. Para uso real, basta uma `GROQ_API_KEY` válida e deixar `GROQ_BASE_URL` sem definir.

## Rodar com Docker

O container executa o processamento uma vez e termina, como uma invocação da Lambda. Ele roda o mesmo `src/invoke-local.ts` do `pnpm invoke`, com Node 24 e `TZ=UTC` (o fuso da Lambda), como usuário sem privilégios. O `.env` não é copiado para a imagem: passe as variáveis no `docker run`.

Construa a imagem:

```bash
docker build -t role-sc-nlp .
```

Execute, informando município e tamanho do lote por argumentos ou pelas variáveis `MUNICIPALITY` e `BATCH_SIZE` (os argumentos têm precedência):

```bash
# Por argumentos: docker run ... role-sc-nlp [municipio] [batchSize]
docker run --rm \
  -e MONGODB_URI=mongodb://host.docker.internal:27017 \
  -e MONGODB_DB_NAME=role_sc \
  -e GROQ_API_KEY=<sua-chave-groq> \
  role-sc-nlp "Camboriú" 20

# Por variáveis (todos os municípios, lote de 50)
docker run --rm \
  -e MONGODB_URI=mongodb://host.docker.internal:27017 \
  -e MONGODB_DB_NAME=role_sc \
  -e GROQ_API_KEY=<sua-chave-groq> \
  -e BATCH_SIZE=50 \
  role-sc-nlp
```

Sem argumentos nem variáveis, processa todos os municípios com lote de 5.

Endereços dentro do container:

- `127.0.0.1` é o próprio container. Para alcançar um Mongo ou um servidor simulado da Groq rodando no host, use `host.docker.internal` (por exemplo `GROQ_BASE_URL=http://host.docker.internal:4112`). No Docker Desktop (Windows e macOS) ele já existe; no Linux, acrescente `--add-host=host.docker.internal:host-gateway`.
- Com o Mongo em outro container, coloque os dois na mesma rede e use o nome do container:

  ```bash
  docker network create role-sc
  docker network connect role-sc role-sc-mongo
  docker run --rm --network role-sc \
    -e MONGODB_URI=mongodb://role-sc-mongo:27017 \
    -e MONGODB_DB_NAME=role_sc \
    -e GROQ_API_KEY=<sua-chave-groq> \
    role-sc-nlp
  ```

- `--env-file .env` também funciona, desde que os endereços do `.env` sejam válidos de dentro do container.

Como no `pnpm invoke`, o container termina com código 0 mesmo em caso de falha; o resultado está no log (`Status` e `success`).

## Variáveis de ambiente

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `MONGODB_URI` | sim | | String de conexão do MongoDB. Local: `mongodb://127.0.0.1:27017`; produção: string do MongoDB Atlas. |
| `MONGODB_DB_NAME` | sim | | Nome do banco (em produção `role_sc`). Precisa ser o mesmo do crawler e da API. |
| `GROQ_API_KEY` | sim | | Chave da API da Groq. Com servidor simulado, qualquer valor não vazio. Só é exigida quando há documento para processar. |
| `GROQ_MODEL` | não | `openai/gpt-oss-20b` | Modelo da Groq usado na extração. |
| `GROQ_BASE_URL` | não | `https://api.groq.com` | Lida pelo `groq-sdk`. Use só para apontar para um servidor compatível ou simulado. |
| `GROQ_LOG` | não | `warn` | Nível de log do `groq-sdk` (`debug`, `info`, `warn`, `error`, `off`). |
| `TZ` | não | fuso da máquina (`UTC` na Lambda e na imagem Docker) | Afeta a conversão de `dataInicio`/`dataFim`: a data vira meia-noite no fuso do processo. Use `UTC` para obter o mesmo resultado da produção. |

Só no container (lidas pelo `ENTRYPOINT` do `Dockerfile`, não pelo código):

| Variável | Padrão | Descrição |
|---|---|---|
| `MUNICIPALITY` | vazio (todos) | Município a processar (nome de exibição, ex.: `Camboriú`). |
| `BATCH_SIZE` | vazio (5) | Quantidade máxima de documentos por execução. |

Na Lambda, `MONGODB_URI`, `MONGODB_DB_NAME`, `GROQ_API_KEY` e `GROQ_MODEL` são definidas pelo `template.yaml` a partir dos parâmetros do deploy, e o município e o lote vêm do evento de invocação (`{"municipality": "...", "batchSize": 50}`).

## Deploy (AWS SAM)

O deploy é manual, feito da máquina do desenvolvedor com o AWS SAM a partir do `template.yaml`.

### Pré-requisitos

- AWS CLI configurada com credenciais que possam criar stacks do CloudFormation, funções Lambda, papéis IAM e agendamentos do EventBridge Scheduler, e usar o bucket S3 de artefatos que o SAM gerencia.
- AWS SAM CLI com suporte a `nodejs24.x`.
- Node.js 24 e pnpm, com as dependências instaladas (`pnpm install`): o build usa o `esbuild`.
- A string de conexão do MongoDB Atlas e a chave da Groq de produção.

### Passo a passo

1. Gere o pacote:

   ```bash
   pnpm build          # executa: sam build
   ```

   O SAM empacota `src/handler.ts` com o esbuild (minificado, alvo `es2022`, sem sourcemap) em `.aws-sam/build/` (ignorado pelo git).

2. Publique:

   ```bash
   pnpm run deploy     # executa: sam deploy --guided
   ```

   Use `pnpm run deploy`: `pnpm deploy` sem o `run` é um comando próprio do pnpm e não executa o script.

   O modo guiado pergunta o nome da stack, a região, os parâmetros do template, se deve confirmar o changeset, se pode criar papéis IAM e se deve salvar as respostas em `samconfig.toml`. Esse arquivo fica só na máquina (está no `.gitignore`); não o versione.

   | Parâmetro | Vira a variável | Padrão | Observação |
   |---|---|---|---|
   | `MongoDbUri` | `MONGODB_URI` | | `NoEcho`; string do Atlas |
   | `MongoDbName` | `MONGODB_DB_NAME` | `role_sc` | |
   | `GroqApiKey` | `GROQ_API_KEY` | | `NoEcho` |
   | `GroqModel` | `GROQ_MODEL` | `openai/gpt-oss-20b` | troca o modelo sem alterar código |

### O que a stack cria

- Função `PROCESSAR_CRAWLS_NLP`: runtime `nodejs24.x`, 256 MB, timeout de 300 s, handler `src/handler.handler`, com as quatro variáveis acima.
- Agendamento `RODAR_PROCESSADOR_NLP_DAS_8_AS_19` (EventBridge Scheduler, `ScheduleV2`): `cron(0 8-19 * * ? *)` no fuso `America/Sao_Paulo`, ou seja, uma execução por hora das 8h às 19h (12 por dia), com o evento `{"batchSize": 50}` (todos os municípios). Estado `ENABLED`.
- Papéis IAM gerados pelo SAM para a função e para o agendamento. O template não declara políticas extras: a função só precisa de acesso à internet (Atlas e Groq).
- Saídas: ARN e nome da função.

Para mudar horário, lote ou município do agendamento, edite `Events.HourlySchedule` no `template.yaml` e faça o deploy de novo.

### Depois do deploy

- O MongoDB Atlas precisa aceitar conexões da Lambda. Ela não roda em VPC e não tem IP fixo, então a lista de acesso de rede do Atlas precisa permitir esse acesso.
- Para testar uma execução e acompanhar os logs:

  ```bash
  aws lambda invoke --function-name PROCESSAR_CRAWLS_NLP \
    --cli-binary-format raw-in-base64-out \
    --payload '{"batchSize": 5}' resposta.json
  aws logs tail /aws/lambda/PROCESSAR_CRAWLS_NLP --follow
  ```

  Em erro fatal (banco inacessível, variável ausente) o handler não lança exceção: devolve `statusCode: 500` com `success: false` no corpo. Para a Lambda a invocação aparece como bem-sucedida, então confira o conteúdo de `resposta.json` e os logs.
