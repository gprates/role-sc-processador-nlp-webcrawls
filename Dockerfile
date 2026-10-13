# Executa o processador NLP uma vez (job) e termina, como uma invocação da Lambda.
# Usa o mesmo caminho do `pnpm invoke`: src/invoke-local.ts -> handler -> runner.
FROM node:24-slim

# Mesma versão do pnpm usada no desenvolvimento.
RUN npm install -g pnpm@12.5.1

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Instala também as devDependencies: o tsx executa o TypeScript sem etapa de build.
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

# TZ=UTC reproduz o fuso da Lambda (afeta a conversão de dataInicio/dataFim).
# MUNICIPALITY vazio = todos os municípios; BATCH_SIZE vazio = 5 (padrão do invoke-local).
ENV TZ=UTC \
    MUNICIPALITY="" \
    BATCH_SIZE=""

USER node

# Argumentos posicionais têm precedência: docker run <imagem> [municipio] [batchSize].
# Sem argumentos, valem as variáveis MUNICIPALITY e BATCH_SIZE.
ENTRYPOINT ["/bin/sh", "-c", "exec node_modules/.bin/tsx src/invoke-local.ts \"${1:-$MUNICIPALITY}\" \"${2:-$BATCH_SIZE}\"", "invoke"]
