# MediChat Frontend

This package contains the Next.js frontend for MediChat. It provides authentication screens, the patient workspace, voice-enabled prompt entry, appointment and medication panels, reminder UI, and the medical profile view.

For the full monorepo setup, PostgreSQL instructions, and end-to-end quick start, see the root guide: [../README.md](../README.md).

## Environment

Create a local env file from `.env.example` and point it at the backend:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

## Install

```bash
npm install
```

## Run in Development

```bash
npm run dev
```

The frontend runs on `http://localhost:3000`.

## Useful Commands

```bash
npm run lint
npm run build
npm run start
```

## How It Connects to the Backend

- Authentication depends on the backend auth routes and HTTP-only cookies.
- Workspace data comes from the backend bootstrap and conversation endpoints.
- Voice input uses the browser speech API in supported browsers and still sends through the same existing message flow.

## Notes

- Keep the backend running before starting the frontend.
- If you change the backend port or hostname, update `NEXT_PUBLIC_API_BASE_URL`.
- For local testing, Chrome or Edge gives the best browser speech support.
