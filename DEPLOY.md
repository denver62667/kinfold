# Publishing Kinfold so others can use it

This covers putting Kinfold on the public internet at a URL you can share. The app
is a Node server (not a static site), so it needs a host that runs Node — plain
static hosts like GitHub Pages won't work.

The good news: **no source needs an API key**, and the app is **stateless** (no
sessions, no database). There's no secret to register and nothing to persist — the
moment you deploy, the public URL works fully.

---

## How a shared instance works

One deployed copy serves everyone. Open Archives, Chronicling America, and the
Internet Archive are all public and read-only, proxied server-side with no per-user
login and no stored state. Visitors share the one instance; nothing about one
visitor's search affects another's.

---

## Before you deploy: prep the repo

1. Make sure `.env` is **not** committed. It's already in `.gitignore`; double check
   with `git status` that `.env` is not listed.
2. Push the project to a Git host (GitHub, GitLab). The included `render.yaml` and
   `Dockerfile` both expect a repo.

---

## Option A — Render (uses the included render.yaml)

Render runs Node services and gives you HTTPS automatically. The repo ships a
`render.yaml` blueprint.

1. Push the repo to GitHub.
2. In Render: **New > Blueprint**, and select your repo. Render reads `render.yaml`
   and proposes a web service named `kinfold`.
3. There are no secrets to paste — `NODE_ENV=production` is set for you.
4. Deploy. Render builds with `npm install`, starts with `node server/index.js`, and
   health-checks `/healthz`.
5. Copy your live URL and share it.

Note: Render's free plan spins the service down when idle, so the first request after
a quiet period is slow. Because the app keeps no state, a spin-down loses nothing.

## Option B — Docker (any container host)

The repo includes a `Dockerfile`. Build and run anywhere that runs containers
(Fly.io, Railway, a VPS, your own machine):

```bash
docker build -t kinfold .
docker run -p 3000:3000 -e NODE_ENV=production kinfold
```

Put the host behind HTTPS (most platforms do this for you).

---

## Production environment variables

| Variable   | Production value                                  |
|------------|---------------------------------------------------|
| `NODE_ENV` | `production` (trusts the platform load balancer)  |
| `PORT`     | Usually injected by the host; defaults to 3000    |

That's the whole list — no secrets, no keys.

---

## Scaling

The app is stateless, so it scales horizontally with no extra work: run as many
instances behind a load balancer as you like. There's no session store to share and
nothing lost on restart or redeploy.

---

## Terms and data responsibilities

Publishing means you're operating under each provider's terms:

- **Open Archives** asks for a descriptive User-Agent and limits to ~4 req/s per IP
  (already respected in `sources/openarchives.js`).
- **Chronicling America** / **Internet Archive** are public APIs from the Library of
  Congress and the Internet Archive; identify your app via the User-Agent (already
  set) and keep request rates reasonable.
- Attribute the sources in your UI and link back to the original documents — Kinfold
  already links out on every record.

---

## Things to consider before a "real" launch

- **Rate limiting / caching.** Each search fans out to several upstream APIs; add a
  short-lived cache or a request-rate guard if traffic grows.
- **Relevance tuning.** `scoring.js` is deterministic and conservative; tune the
  weights or thresholds to taste for your audience.
