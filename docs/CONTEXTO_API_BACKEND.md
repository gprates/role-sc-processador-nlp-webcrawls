# Contexto Completo — Projeto API Backend

Documento para transferência de contexto entre chats. Leia tudo antes de começar a implementar.

---

## 1. VISÃO GERAL DO ECOSSISTEMA

Este projeto faz parte de um TCC cujo objetivo é um **aplicativo mobile em React Native (Expo)** que exibe automaticamente **eventos culturais e municipais** dos municípios: **Itajaí, Camboriú, Porto Belo, Itapema e Bombinhas** (SC).

O ecossistema é dividido em 4 projetos com responsabilidades isoladas:

| Projeto | Responsabilidade | Status |
|---------|-----------------|--------|
| **role-sc-web-crawler** | Crawling com Playwright → salva texto bruto no MongoDB Atlas | ✅ Implementado e rodando em AWS Lambda |
| **role-sc-processador-nlp-webcrawls** | Lê `raw_crawls`, processa com IA (Groq/Llama), gera eventos estruturados | ✅ Implementado e rodando em AWS Lambda |
| **api** (este) | Expõe a coleção `eventos` via REST + autenticação JWT | 🔨 A implementar |
| **app** | React Native (Expo) — exibe eventos com filtros por região | Futuro |

**Fluxo completo:**
```
Sites municipais → Lambda Crawler → MongoDB (raw_crawls)
                                           ↓
                              Lambda NLP (Groq/Llama 3.1 8B)
                                           ↓
                              MongoDB (eventos processados)
                                           ↓
                              Lambda API (Fastify) ← ESTE PROJETO
                                           ↓
                                    App React Native (Expo)
```

---

## 2. CONTEXTO DOS PROJETOS ANTERIORES

### 2.1 Web Crawler (`role-sc-web-crawler`)

- **Lambda AWS** com Playwright + Chromium (`@sparticuz/chromium`)
- Crawlers implementados: **Camboriú** (prefeitura) e **Fundação Cultural de Itajaí**
- Navega pelas páginas de notícias, extrai título, data de publicação e corpo do artigo
- Salva na coleção `raw_crawls` com `processed: false`
- Deduplicação por `url` (não insere duplicatas)
- Deploy manual via `lambda.zip`
- Runtime: Node.js 22.x, 1024 MB, timeout 5 min

### 2.2 NLP Processor (`role-sc-processador-nlp-webcrawls`)

- **Lambda AWS** via **SAM** (`template.yaml`)
- Trigger: **EventBridge** cron às 6h30 UTC (após o crawler)
- Busca documentos `raw_crawls` com `processed: false`
- Envia `rawText` para a **API Groq** (modelo `llama-3.1-8b-instant`, JSON mode, temperature 0.1)
- Prompt em português classifica se é evento ou não e extrai: título, descrição, dataInício, dataFim, horário, local, categoria
- Salva na coleção `eventos` (inclusive não-eventos com `isEvent: false`)
- Marca `processed: true` no `raw_crawl` original
- Retry com backoff em rate limit (429), delay de 2.5s entre chamadas
- Deduplicação por `url` (índice único)
- Runtime: Node.js 24.x, 256 MB, timeout 5 min

---

## 3. O QUE A API FAZ

É uma **AWS Lambda** com **Fastify** que:

1. Expõe a coleção `eventos` via endpoints REST com filtros e paginação
2. Gerencia autenticação de usuários (cadastro, login) com JWT
3. Protege rotas com verificação de token JWT
4. Fornece metadados auxiliares (lista de municípios e categorias)

A API é **somente leitura** em relação a eventos — ela consulta a coleção `eventos` populada pelo NLP Processor. A única escrita que a API faz é na coleção `users` (cadastro de usuários).

---

## 4. DADOS DE ENTRADA — coleção `eventos` (somente leitura)

Esta coleção já existe e é populada pelo NLP Processor. A API apenas consulta.

```typescript
interface Evento {
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
  publishedAt: string;
  processedAt: Date;
  rawCrawlId: ObjectId;
}
```

**Índices existentes (criados pelo NLP Processor):**
- `{ url: 1 }` — único
- `{ municipio: 1, isEvent: 1 }` — composto
- `{ dataInicio: 1 }`

**Categorias válidas:**
`"Cultura"`, `"Esporte"`, `"Gastronomia"`, `"Educação"`, `"Saúde"`, `"Meio Ambiente"`, `"Turismo"`, `"Religião"`, `"Outro"`

**Municípios ativos (com crawlers implementados):**
`"Camboriú"`, `"Itajaí"`

**Observação:** Nem todos os documentos na coleção são eventos reais. Documentos com `isEvent: false` são notícias genéricas que a IA identificou como não-eventos. A API deve filtrar automaticamente por `isEvent: true` ao listar eventos.

---

## 5. DADOS DE USUÁRIOS — coleção `users` (nova)

```typescript
interface User {
  _id?: ObjectId;
  nome: string;
  email: string;       // índice único
  senha: string;       // hash bcrypt (nunca retornar em responses)
  createdAt: Date;
}

type UserInsert = Omit<User, '_id'>;

// Response shape (sem senha)
interface UserPublic {
  _id: string;
  nome: string;
  email: string;
  createdAt: Date;
}
```

**Índices:**
- `{ email: 1 }` — único (impede cadastro duplicado)

---

## 6. CONTRATO DA API — ENDPOINTS

### 6.1 Autenticação (rotas públicas)

#### `POST /auth/register`

Cria uma nova conta de usuário.

**Request body:**
```json
{
  "nome": "Gabriel Prates",
  "email": "gabriel@email.com",
  "senha": "minhasenha123"
}
```

**Validações:**
- `nome`: string, mínimo 2 caracteres, obrigatório
- `email`: string, formato email válido, obrigatório, único
- `senha`: string, mínimo 6 caracteres, obrigatório

**Response 201:**
```json
{
  "success": true,
  "message": "Usuário criado com sucesso"
}
```

**Response 409 (email duplicado):**
```json
{
  "success": false,
  "message": "Email já cadastrado"
}
```

#### `POST /auth/login`

Autentica e retorna JWT.

**Request body:**
```json
{
  "email": "gabriel@email.com",
  "senha": "minhasenha123"
}
```

**Response 200:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "_id": "664a1b2c3d4e5f6a7b8c9d0e",
    "nome": "Gabriel Prates",
    "email": "gabriel@email.com",
    "createdAt": "2026-04-14T12:00:00.000Z"
  }
}
```

**Response 401 (credenciais inválidas):**
```json
{
  "success": false,
  "message": "Email ou senha inválidos"
}
```

---

### 6.2 Rotas protegidas (JWT obrigatório)

Todas as rotas abaixo exigem o header:
```
Authorization: Bearer <token>
```

Se o token for inválido ou ausente, retorna **401**:
```json
{
  "success": false,
  "message": "Token inválido ou ausente"
}
```

#### `GET /auth/me`

Retorna os dados do usuário logado.

**Response 200:**
```json
{
  "success": true,
  "user": {
    "_id": "664a1b2c3d4e5f6a7b8c9d0e",
    "nome": "Gabriel Prates",
    "email": "gabriel@email.com",
    "createdAt": "2026-04-14T12:00:00.000Z"
  }
}
```

#### `GET /eventos`

Lista eventos com filtros e paginação. Retorna **apenas** documentos com `isEvent: true`.

**Query parameters (todos opcionais):**

| Param | Tipo | Descrição | Exemplo |
|-------|------|-----------|---------|
| `municipio` | string | Filtrar por município | `Itajaí` |
| `categoria` | string | Filtrar por categoria | `Cultura` |
| `dataInicio` | string (YYYY-MM-DD) | Eventos a partir dessa data | `2026-04-01` |
| `dataFim` | string (YYYY-MM-DD) | Eventos até essa data | `2026-04-30` |
| `search` | string | Busca textual no título e descrição | `festival` |
| `page` | number | Página (default: 1) | `1` |
| `limit` | number | Itens por página (default: 20, max: 50) | `20` |

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "664b...",
      "titulo": "3ª edição do Festival Sabores do Mar",
      "descricao": "Festival gastronômico com mais de 30 expositores na Praça Central.",
      "dataInicio": "2026-03-22T00:00:00.000Z",
      "dataFim": null,
      "horario": "10h às 22h",
      "local": "Praça Central, Camboriú",
      "categoria": "Gastronomia",
      "municipio": "Camboriú",
      "site": "Camboriú",
      "url": "https://camboriu.sc.gov.br/noticia/festival-sabores-do-mar",
      "publishedAt": "14 de março de 2026",
      "processedAt": "2026-03-14T09:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 47,
    "totalPages": 3
  }
}
```

**Lógica de filtro no MongoDB:**
```typescript
const filter: Record<string, unknown> = { isEvent: true };

if (municipio) filter.municipio = municipio;
if (categoria) filter.categoria = categoria;
if (dataInicio || dataFim) {
  filter.dataInicio = {};
  if (dataInicio) filter.dataInicio.$gte = new Date(dataInicio);
  if (dataFim) filter.dataInicio.$lte = new Date(dataFim);
}
if (search) {
  filter.$or = [
    { titulo: { $regex: search, $options: 'i' } },
    { descricao: { $regex: search, $options: 'i' } },
  ];
}
```

**Ordenação padrão:** `{ dataInicio: -1 }` (eventos mais recentes primeiro).

#### `GET /eventos/:id`

Retorna os detalhes de um evento específico.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "_id": "664b...",
    "titulo": "Exposição Fotográfica Litoral Vivo",
    "descricao": "Exposição com fotos do litoral catarinense...",
    "dataInicio": "2026-03-15T00:00:00.000Z",
    "dataFim": "2026-04-15T00:00:00.000Z",
    "horario": "19h",
    "local": "Centro Cultural Itajaí",
    "categoria": "Cultura",
    "municipio": "Itajaí",
    "site": "Fundação Cultural de Itajaí",
    "url": "https://fundacaocultural.itajai.sc.gov.br/noticias/exposicao-litoral-vivo",
    "publishedAt": "10 de março de 2026",
    "processedAt": "2026-03-10T09:30:00.000Z"
  }
}
```

**Response 404:**
```json
{
  "success": false,
  "message": "Evento não encontrado"
}
```

#### `GET /municipios`

Retorna a lista de municípios que possuem eventos cadastrados.

**Response 200:**
```json
{
  "success": true,
  "data": ["Camboriú", "Itajaí"]
}
```

**Lógica:** `db.collection('eventos').distinct('municipio', { isEvent: true })`

#### `GET /categorias`

Retorna a lista de categorias válidas.

**Response 200:**
```json
{
  "success": true,
  "data": ["Cultura", "Esporte", "Gastronomia", "Educação", "Saúde", "Meio Ambiente", "Turismo", "Religião", "Outro"]
}
```

**Lógica:** Retorna a lista fixa de categorias (constante no código, igual ao NLP Processor).

---

## 7. FLUXO DE AUTENTICAÇÃO (JWT)

### Por que JWT customizado (e não Cognito)
- Mais educativo para o TCC — entende-se e explica-se cada etapa
- Mantém tudo no MongoDB, sem adicionar mais um serviço AWS
- Simples de implementar e debugar no escopo do TCC
- Cognito seria overkill para essa escala

### Fluxo completo

```
1. POST /auth/register
   → Valida dados (JSON Schema do Fastify)
   → Verifica email duplicado
   → Hash bcrypt da senha (salt rounds: 10)
   → Salva no MongoDB (coleção users)
   → Retorna 201

2. POST /auth/login
   → Busca user por email
   → Compara senha com bcrypt.compare()
   → Gera JWT com payload { userId, email }
   → Retorna 200 com token + dados do user (sem senha)

3. Requisição protegida
   → App envia header: Authorization: Bearer <token>
   → auth.hook.ts extrai o token do header
   → Verifica com jwt.verify(token, JWT_SECRET)
   → Decodifica { userId, email } e injeta no request
   → Se inválido/expirado → 401
   → Se válido → prossegue para o handler da rota
```

### Configuração JWT
- **Algoritmo:** HS256 (padrão do jsonwebtoken)
- **Payload:** `{ userId: string, email: string }`
- **Expiração:** configurável via `JWT_EXPIRES_IN` (sugestão: `"7d"`)
- **Secret:** variável de ambiente `JWT_SECRET` (string longa e aleatória)

---

## 8. STACK DO PROJETO

Seguir o mesmo padrão dos projetos anteriores do TCC:

| Tecnologia | Versão | Uso |
|-----------|--------|-----|
| TypeScript | ^5.x | Linguagem principal |
| Node.js | 24.x | Runtime |
| pnpm | latest | Package manager |
| Fastify | ^5 | Framework HTTP |
| @fastify/aws-lambda | latest | Adapter para rodar Fastify em Lambda |
| @fastify/cors | latest | CORS (necessário para o app chamar a API) |
| mongodb | ^7 | Cliente MongoDB |
| bcrypt | latest | Hash de senhas |
| jsonwebtoken | latest | Geração e verificação de JWT |
| dotenv | ^17 | Variáveis de ambiente (dev local) |
| tsx | ^4 | Execução local TypeScript |

**Dev dependencies:** `@types/node`, `@types/bcrypt`, `@types/jsonwebtoken`, `esbuild`, `typescript`

---

## 9. ARQUITETURA SUGERIDA

```
src/
├── handler.ts                  ← entry point da Lambda
├── app.ts                      ← setup Fastify, plugins, registro de rotas
├── invoke-local.ts             ← servidor local para desenvolvimento
├── routes/
│   ├── auth.routes.ts          ← POST /auth/register, POST /auth/login, GET /auth/me
│   ├── evento.routes.ts        ← GET /eventos, GET /eventos/:id
│   └── metadata.routes.ts      ← GET /municipios, GET /categorias
├── services/
│   ├── auth.service.ts         ← lógica de registro, login, geração JWT
│   └── evento.service.ts       ← queries com filtros, paginação, busca
├── hooks/
│   └── auth.hook.ts            ← preHandler do Fastify que verifica JWT
├── database/
│   ├── mongodb.connection.ts   ← conexão singleton (mesmo padrão do NLP)
│   └── repositories/
│       ├── user.repository.ts  ← CRUD da coleção users
│       └── evento.repository.ts ← queries da coleção eventos
├── types/
│   ├── user.types.ts           ← User, UserInsert, UserPublic
│   ├── evento.types.ts         ← Evento, Categoria, CATEGORIAS_VALIDAS
│   └── auth.types.ts           ← LoginBody, RegisterBody, JwtPayload
├── schemas/
│   ├── auth.schemas.ts         ← JSON Schema para validação do Fastify
│   └── evento.schemas.ts       ← JSON Schema para query params
└── utils/
    ├── jwt.utils.ts            ← signToken, verifyToken, extractTokenFromHeader
    └── logger.utils.ts         ← createLogger (mesmo padrão do NLP)
```

### Design Patterns

- **Repository Pattern** — acesso ao banco encapsulado (consistente com crawler e NLP)
- **Service Layer** — lógica de negócio separada das rotas
- **Fastify Hooks** — `preHandler` para autenticação (não middleware Express-style)
- **JSON Schema Validation** — validação nativa do Fastify nos endpoints
- **Singleton** — conexão MongoDB reutilizada entre invocações Lambda

---

## 10. HANDLER DA LAMBDA

O Fastify roda dentro da Lambda usando o adapter `@fastify/aws-lambda`:

```typescript
// handler.ts
import awsLambdaFastify from '@fastify/aws-lambda';
import { buildApp } from './app';

const app = buildApp();
const proxy = awsLambdaFastify(app);

export const handler = async (event: any, context: any) => {
  return proxy(event, context);
};
```

```typescript
// app.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { authRoutes } from './routes/auth.routes';
import { eventoRoutes } from './routes/evento.routes';
import { metadataRoutes } from './routes/metadata.routes';

export const buildApp = () => {
  const app = Fastify({ logger: true });

  app.register(cors);
  app.register(authRoutes, { prefix: '/auth' });
  app.register(eventoRoutes, { prefix: '/eventos' });
  app.register(metadataRoutes);

  return app;
};
```

```typescript
// invoke-local.ts (desenvolvimento)
import 'dotenv/config';
import { buildApp } from './app';

const start = async () => {
  const app = buildApp();
  await app.listen({ port: 3000, host: '0.0.0.0' });
  console.log('API rodando em http://localhost:3000');
};

start();
```

---

## 11. CONFIGURAÇÃO AWS

| Parâmetro | Valor |
|-----------|-------|
| Runtime | Node.js 24.x |
| Handler | `handler.handler` |
| Memória | 256 MB |
| Timeout | 30 segundos |
| API Gateway | HTTP API (mais barato que REST API) |
| Rota | `ANY /{proxy+}` → Lambda (catch-all) |

**SAM template — recursos principais:**
- `AWS::Serverless::Function` com evento `HttpApi` (não `Api`)
- `HttpApi` com rota `/{proxy+}` e método `ANY` + CORS habilitado
- Parâmetros: `MongoDbUri`, `MongoDbName`, `JwtSecret`, `JwtExpiresIn`

**Variáveis de ambiente:**

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `MONGODB_URI` | Connection string do Atlas | `mongodb+srv://...` |
| `MONGODB_DB_NAME` | Nome do banco | `role_sc` |
| `JWT_SECRET` | Secret para assinar tokens JWT | string aleatória longa |
| `JWT_EXPIRES_IN` | Tempo de expiração do token | `7d` |

**Sobre domínio:** O API Gateway HTTP API fornece automaticamente uma URL HTTPS gratuita no formato `https://<id>.execute-api.<region>.amazonaws.com`. Para o TCC, isso é suficiente — não é necessário um domínio customizado.

---

## 12. CONSIDERAÇÕES IMPORTANTES

### Performance
- A Lambda reutiliza a conexão MongoDB entre invocações (cold start apenas na primeira)
- Fastify é significativamente mais rápido que Express em benchmarks
- HTTP API Gateway tem menor latência que REST API Gateway
- Com 256 MB de memória e sem browser/IA, o cold start é mínimo (~200-400ms)

### Segurança
- Senhas nunca são retornadas em nenhum endpoint
- Hash bcrypt com 10 salt rounds
- JWT com expiração configurável
- CORS configurado para aceitar requests do app

### Paginação
- Default: 20 itens por página
- Máximo: 50 itens por página
- Retorna metadata de paginação: `page`, `limit`, `total`, `totalPages`

### Tratamento de erros
- Validação via JSON Schema do Fastify (retorna 400 automaticamente com detalhes)
- Erros de autenticação: 401
- Recurso não encontrado: 404
- Email duplicado: 409
- Erros internos: 500 com mensagem genérica (sem expor detalhes)

### Banco de dados
- Mesmo cluster MongoDB Atlas usado pelo crawler e NLP
- Mesmo banco (`role_sc`)
- Coleções: `eventos` (leitura), `users` (escrita)
- Índices na coleção `users` devem ser criados pela API na inicialização

---

## 13. PRINCÍPIOS DO USUÁRIO

- **Pragmatismo sobre perfeccionismo**
- **Boas práticas e SOLID**
- **Analisar design patterns** (refactoring.guru) antes de implementar
- **Baixa complexidade** — evitar over-engineering
- **Stack AWS preferred**
- Sempre justificar as decisões técnicas
- Manter consistência com os projetos anteriores (crawler e NLP)

---

## 14. FUNCIONALIDADES FUTURAS (não implementar agora)

Estas funcionalidades estão no roadmap, mas **não devem ser implementadas nesta fase**. A arquitetura deve apenas facilitar a adição futura:

- **Favoritos** — usuário salva eventos favoritos (`POST /favoritos`, `GET /favoritos`)
- **Notificações push** — avisar sobre novos eventos por município
- **Compartilhamento** — gerar link de compartilhamento de evento
- **Filtro por proximidade** — eventos próximos à localização do usuário

---

## 15. PRÓXIMOS PASSOS APÓS A API

1. **App Mobile** — React Native com Expo, Android only, consumindo esta API
2. **Requisitos Funcionais e Não-Funcionais** — documento para o TCC
3. **Crawlers adicionais** — Porto Belo, Itapema, Bombinhas (no projeto do crawler)

---

*Documento gerado em abril de 2026 para transferência de contexto entre chats.*
