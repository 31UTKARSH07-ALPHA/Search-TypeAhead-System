FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY services/batch-worker/package.json services/batch-worker/package.json
RUN npm ci --workspace @typeahead/shared-types --workspace @typeahead/batch-worker --include-workspace-root

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-types ./packages/shared-types
COPY services/batch-worker ./services/batch-worker
RUN npm run build --workspace @typeahead/shared-types
RUN npm run build --workspace @typeahead/batch-worker

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared-types ./packages/shared-types
COPY --from=build /app/services/batch-worker ./services/batch-worker
WORKDIR /app/services/batch-worker
EXPOSE 4003
CMD ["npm", "run", "start"]
