# Publishing Kinfold so others can use it

This covers putting Kinfold on the public internet at a URL you can share. The
app is a Node server (not a static site), so it needs a host that runs Node —
plain static hosts like GitHub Pages won't work.

The good news: **no source needs an API key**, so there's no approval step and no
secret to register. The moment you deploy, the public URL works fully.

---

## How a shared instance works

One deployed copy can serve many people. WikiTree, Wikidata, and Open Archives are
all public and read-only, proxied server-side with no per-user login. A session is
still created per visitor (it holds their in-progress agent tree), but no
credentials are involved.

---

## Before you deploy: prep the repo

1. Make sure `.env` is **not** committed. It's already in `.gitignore`; double
   check with `git status` that `.env` is not listed.
2. Push the project to a Git host (GitHub, GitLab). The included `render.yaml`
   and `Dockerfile` both expect a repo.

---

## Option A — Render (uses the included render.yaml)

Render runs Node services and gives you HTTPS automatically. The repo ships a
`render.yaml` blueprint.

1. Push the repo to GitHub.
2. In Render: **New > Blueprint**, and select your repo. Render reads
   `render.yaml` and proposes a web service named `kinfold`.
3. There are no secrets to paste — `SESSION_SECRET` is generated for you and
   `NODE_ENV=production` is set.
4. Deploy. Render builds with `npm install`, starts with `node server/index.js`,
   and health-checks `/healthz`.
5. Copy your live URL and share it.

Note: Render's free plan spins the service down when idle, so the first request
after a quiet period is slow, and because sessions are kept in memory, a spin-down
clears in-progress agent trees (visitors just rebuild). For an always-on instance
use a paid plan or add a session store (below).

## Option B — Docker (any container host)

The repo includes a `Dockerfile`. Build and run anywhere that runs containers
(Fly.io, Railway, a VPS, your own machine):

```bash
docker build -t kinfold .
docker run -p 3000:3000 -e NODE_ENV=production -e SESSION_SECRET=some-long-random-string kinfold
```

Put the host behind HTTPS (most platforms do this for you).

---

## Production environment variables

| Variable           | Production value                                             |
|--------------------|-------------------------------------------------------------|
| `NODE_ENV`         | `production` (enables secure cookies + proxy trust)         |
| `SESSION_SECRET`   | A long random string (generate one; keep it secret)         |
| `WIKITREE_APP_ID`  | Any label, e.g. `kinfold`                                    |

Set these in your host's dashboard, **never** in committed files.

---

## Scaling and sessions

The app stores each visitor's in-progress agent tree in a server-side session
using the default in-memory store. That's fine for a single instance and modest
traffic, but it has two consequences worth knowing:

- Sessions (and agent trees) are lost on restart/redeploy.
- It won't work correctly across multiple instances (a visitor could hit an
  instance that doesn't have their session).

If you outgrow that, add a shared session store (e.g. Redis via
`connect-redis`) and point all instances at it. The rest of the app is unchanged.

---

## Security checklist

- `.env` and `node_modules` stay out of Git (already in `.gitignore`).
- All real secrets come from the host's environment settings, not the repo.
- `NODE_ENV=production` turns on `secure` cookies and proxy trust, so the session
  cookie only travels over HTTPS — make sure your host terminates TLS (Render,
  Fly, Railway all do).

---

## Terms and data responsibilities

Publishing means you're operating under each provider's terms:

- **WikiTree** exposes only public profiles through the API; respect their app
  policies and the trusted-list privacy model.
- **Wikidata** is openly licensed (CC0), but Wikimedia requires a descriptive
  `User-Agent` and reasonable request rates — Kinfold sets the UA and makes calls
  sequentially; keep it that way.
- **Open Archives** asks for a descriptive User-Agent and limits to ~4 req/s per
  IP (already respected in `openarchives.js`).
- Attribute the sources in your UI and link back to the original profiles and
  records (Kinfold already links out).

---

## Known limitations to fix before a "real" launch

- **In-memory sessions / agent trees** (see Scaling above).
- **Match scoring** is deterministic and conservative by design; for a product you
  might tune thresholds or surface more candidates per question.
