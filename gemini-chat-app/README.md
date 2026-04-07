# MediChat Backend

This package contains the Express API for MediChat. It handles authentication, PostgreSQL persistence, Gemini-powered responses, appointment and medication storage, and generated medical profiles.

For the full monorepo setup and contributor guide, see the root guide: [../README.md](../README.md).

## Environment

Create a local `.env` file from `.env.example`.

```env
PORT=4000
CLIENT_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://medichat_user:medichat_password@localhost:5432/medichat
JWT_SECRET=replace-this-with-a-long-random-secret
JWT_EXPIRES_IN=7d
COOKIE_NAME=medichat_token
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-1.5-flash
```

## PostgreSQL Setup

- Point `DATABASE_URL` at a running PostgreSQL database.
- On startup the server runs `ensureDatabaseReady()` from `db.js`, which creates the required tables automatically if they do not exist.
- If you prefer manual schema creation, run:

```bash
psql -U medichat_user -d medichat -f db/init.sql
```

## Install

```bash
npm install
```

## Run in Development

```bash
npm run dev
```

The backend runs on `http://localhost:4000`.

## Other Commands

```bash
npm start
```

## Key API Routes

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/logout`
- `GET /workspace/bootstrap`
- `POST /conversation/message`
- `GET /medical-profile`
- `POST /chat`

## Notes

- `CLIENT_ORIGIN` must match the actual frontend URL for cookie-based auth to work correctly.
- The database schema is also mirrored in `db/init.sql` for manual setup and Docker bootstrap use cases.
- Keep your Gemini API key and JWT secret out of version control.
