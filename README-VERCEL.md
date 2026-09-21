# Smart Parking — Vercel Deployment

## 1. Database
This project requires a remote MySQL database. A MySQL server running on your PC (`localhost` / `127.0.0.1`) will not work from Vercel.

Create these Vercel Environment Variables:

- `DB_HOST` — remote MySQL hostname
- `DB_PORT` — normally `3306`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME` — normally `smart_parking`
- `SESSION_SECRET` — a long random secret (at least 32 characters)
- `NODE_ENV=production`

`DB_CREATE_DATABASE` should normally be left unset/false when using a managed database. Create the database first, then let the app create its tables on first API request.

## 2. Deploy
1. Push this folder to GitHub.
2. Import the repository into Vercel.
3. Framework Preset: **Other**.
4. Build Command: leave empty.
5. Install Command: `npm install` (Vercel can also detect this automatically).
6. Add the environment variables above to Production.
7. Deploy.

## 3. Local development
```bash
npm install
npm start
```

For local MySQL, copy `.env.example` to `.env` and fill in the local values.

## 4. Important Vercel changes
- Express is exposed through `api/index.js` and `api/[...path].js`.
- Static HTML/CSS/JS files are served by Vercel's filesystem layer.
- The old catch-all rewrite was removed because it could intercept static files.
- Login sessions use a signed, stateless HttpOnly cookie instead of an in-memory `Map`, which is compatible with serverless instances.
- Database initialization runs lazily on the first API request of a warm serverless instance.
- Non-auth API endpoints require an authenticated session.
