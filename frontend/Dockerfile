FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace @typeahead/shared-types --workspace @typeahead/frontend --include-workspace-root

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-types ./packages/shared-types
COPY frontend ./frontend
RUN npm run build --workspace @typeahead/shared-types
WORKDIR /app/frontend
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json /app/tsconfig.base.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared-types ./packages/shared-types
COPY --from=build /app/frontend ./frontend
WORKDIR /app/frontend
EXPOSE 3000
CMD ["npm", "run", "start"]
