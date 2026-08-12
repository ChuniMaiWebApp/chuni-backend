# ChunithmWebApp — Backend API

REST API server for ChunithmWebApp, built with NestJS 11, PostgreSQL, and Redis.

## Quickstart (Localhost)

### 1. Prerequisites
- Node.js >= 20.x
- PostgreSQL >= 14
- Redis >= 6

### 2. Setup & Installation

```bash
# Clone repository
git clone https://github.com/ChuniMaiWebApp/chuni-backend.git
cd chuni-backend

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env
```

Ensure `DATABASE_URL` and `REDIS_HOST` are properly configured in `.env`.

### 3. Database Migration & Run Server

```bash
# Run database migrations
npm run migrate

# Start development server
npm run start:dev
```

- API Server: `http://localhost:3333/api/v1`
- Swagger Docs: `http://localhost:3333/api/docs` (when `SWAGGER_ENABLED=true`)

### Scripts

- `npm run start:dev` — Start dev server with hot reload
- `npm run build` — Compile TypeScript to `dist/`
- `npm run migrate` — Apply database migrations (`node scripts/migrate.js`)
- `npm run test` — Run unit tests with Jest
- `npm run lint:ci` — Verify code style and formatting

---

## Credits & Acknowledgements

Special thanks to the open-source community and project creators whose work made this platform possible:

- **[chuni-penguin](https://github.com/beer-psi/chuni-penguin)** by [beerpsi](https://github.com/beer-psi) — The original inspiration for this project.
- **[chunirec](https://developer.chunirec.net/)** — Essential chart constants and rating dataset.
- **[arcade-songs](https://github.com/zetaraku/arcade-songs)** by [zetaraku](https://github.com/zetaraku) — Data mapping and schema references.
