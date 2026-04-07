# MediChat Monorepo

MediChat is a full-stack patient support workspace with a Next.js frontend and an Express/PostgreSQL backend. It combines secure authentication, AI-assisted health conversations, structured appointment and medication tracking, reminder-driven workflows, and a generated medical profile that grows with each user session.

## Features

- Username and password authentication with JWT cookies
- One persisted conversation per user, stored in PostgreSQL
- Dedicated panels for chat, appointment scheduling, medication tracking, symptom analysis, preliminary assessment, and medical profile review
- Appointment and medication reminder surfaces in the UI
- AI-generated patient profile that refreshes after every five user prompts
- Browser voice input for the shared composer in supported browsers

## Monorepo Layout

```text
.
|-- gemini-chat-app/   # Express API, auth, Gemini integration, Postgres access
|-- medichat-ui/       # Next.js frontend workspace
`-- docker-compose.yml # Optional local Postgres shortcut
```

## Tech Stack

- Frontend: Next.js 16, React 19, TypeScript, Tailwind-based UI
- Backend: Express 5, Node.js, PostgreSQL, raw `pg`
- AI: Google Gemini via `@google/generative-ai`
- Auth: bcrypt password hashing and JWT auth cookies

## Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- PostgreSQL 14 or newer
- A Gemini API key
- Chrome or Edge if you want to use browser voice input

## Quick Start with Native PostgreSQL

This is the recommended setup for other developers using the project outside Docker.

### 1. Create the PostgreSQL user and database

Open `psql` as a superuser and run:

```sql
CREATE ROLE medichat_user WITH LOGIN PASSWORD 'medichat_password';
CREATE DATABASE medichat OWNER medichat_user;
GRANT ALL PRIVILEGES ON DATABASE medichat TO medichat_user;
```

You can change the role name, password, and database name if you prefer. Just keep the same values in `DATABASE_URL`.

### 2. Configure environment files

Create these local environment files from the examples:

- `gemini-chat-app/.env`
- `medichat-ui/.env.local` or `medichat-ui/.env`

Backend example values:

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

Frontend example values:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

### 3. Install dependencies

Backend:

```bash
cd gemini-chat-app
npm install
```

Frontend:

```bash
cd medichat-ui
npm install
```

### 4. Initialize the database tables

Recommended path:

- Start the backend once. On startup it runs `ensureDatabaseReady()` and creates the required tables automatically if they do not exist yet.

Optional manual path:

```bash
psql -U medichat_user -d medichat -f gemini-chat-app/db/init.sql
```

### 5. Start the backend

```bash
cd gemini-chat-app
npm run dev
```

The API will be available at `http://localhost:4000`.

### 6. Start the frontend

```bash
cd medichat-ui
npm run dev
```

The UI will be available at `http://localhost:3000`.

### 7. Start using the app

1. Open `http://localhost:3000`.
2. Register a new account or sign in.
3. Use the workspace panels for general chat, symptom discussion, assessments, appointments, medications, and profile review.
4. Review voice-dictated prompts in the input before sending.

## Database Overview

The project currently uses these live tables:

| Table | Purpose |
| --- | --- |
| `users` | Stores app accounts and password hashes |
| `conversations` | Stores the single persistent conversation id for each user |
| `messages` | Stores all user and assistant messages, tagged by workspace mode |
| `appointments` | Stores appointment reminders created from the appointment panel |
| `medication_schedules` | Stores daily, weekly, and seldom medication reminder schedules |
| `user_profiles` | Stores the generated medical summary, structured profile, and prompt counters |

## Recommended Usage Flow

### For patients or testers

1. Create an account and log in.
2. Use `Chat` for general support and follow-up questions.
3. Use `Symptom Analysis` or `Preliminary Assessment` when you want guided questioning.
4. Use `Schedule Appointment` only when you can provide a clear date and time.
5. Use `Medication Tracking` with explicit times or dates so reminders can be generated correctly.
6. Check `Medical Profile` after a few interactions. It refreshes after every five user prompts.

### For developers

- Keep frontend and backend ports aligned with `CLIENT_ORIGIN` and `NEXT_PUBLIC_API_BASE_URL`.
- Treat generated medical output as assistive, not diagnostic.
- Restart the backend after env changes.
- Use PostgreSQL backups or snapshots if you care about retaining demo data.

## Best Practices

- Never commit real `.env` files, database passwords, or production API keys.
- Replace the sample database password and JWT secret before sharing beyond local development.
- Use HTTPS and secure cookie settings in production environments.
- Keep appointment and medication prompts structured so the backend can save them reliably.
- Remember that browser voice input depends on browser support and microphone permission.
- Keep Docker optional for local convenience, but document native PostgreSQL as the default team setup.

## Troubleshooting

### Backend cannot connect to PostgreSQL

- Verify PostgreSQL is running.
- Confirm the role, password, host, port, and database in `DATABASE_URL`.
- Test the connection separately with `psql`.

### Tables do not exist

- Start the backend once to trigger automatic schema creation.
- If needed, run `psql -U medichat_user -d medichat -f gemini-chat-app/db/init.sql`.

### Login works but frontend requests fail

- Confirm `CLIENT_ORIGIN` matches the actual frontend URL.
- Confirm `NEXT_PUBLIC_API_BASE_URL` points to the running backend.
- Restart both servers after env changes.

### Voice input is unavailable

- Use Chrome or Edge.
- Allow microphone permission in the browser.
- Review the dictated text before sending; voice input does not auto-send prompts.

## Optional Docker Shortcut

If you do want a Docker-backed local database, the repo already includes `docker-compose.yml`.

```bash
docker compose up -d
```

That starts a local PostgreSQL container and mounts `gemini-chat-app/db/init.sql` for initial schema creation. Native PostgreSQL remains the preferred setup for general contributors.

## Package-Level Docs

- Backend guide: [gemini-chat-app/README.md](./gemini-chat-app/README.md)
- Frontend guide: [medichat-ui/README.md](./medichat-ui/README.md)
