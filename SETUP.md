# Setup guide — running Kinfold on your computer

This walks through everything from zero. No prior Node.js experience assumed.
Plan for ~5 minutes.

Kinfold needs **no API keys**. WikiTree (public profiles), Wikidata, and Open
Archives all work without registration.

---

## Step 1 — Install Node.js

Kinfold needs Node.js version 18 or newer.

1. Go to https://nodejs.org and download the **LTS** version.
2. Run the installer with the default options.
3. Confirm it worked. Open a terminal (macOS: Terminal; Windows: PowerShell) and run:

   ```bash
   node --version
   ```

   You should see something like `v20.x.x`. If the number is 18 or higher,
   you're set. If the command isn't found, close and reopen the terminal, or
   restart your computer so the install registers.

---

## Step 2 — Get the project onto your computer

If you downloaded the project as a folder already, just note where it is
(e.g. `Downloads/genealogy-crossref`).

If it's in a Git repository:

```bash
git clone <your-repo-url>
cd genealogy-crossref
```

Either way, open a terminal **in the project folder** — the one containing
`package.json`. To check you're in the right place:

```bash
ls
```

You should see `package.json`, `server`, `public`, and `README.md`.

---

## Step 3 — Install the project's dependencies

This downloads the few libraries Kinfold uses (Express, etc.) into a local
`node_modules` folder. Run:

```bash
npm install
```

It prints a summary when done. A `node_modules` folder now exists — you never
edit it, and it's already excluded from Git.

---

## Step 4 — (Optional) Create your settings file

Kinfold runs with sensible defaults, so this step is optional. To customize the
port or set a session secret, copy the template `.env.example` to `.env`:

macOS / Linux:

```bash
cp .env.example .env
```

Windows (PowerShell):

```powershell
Copy-Item .env.example .env
```

Open `.env` in any text editor. The only thing worth setting is:

```
SESSION_SECRET=paste-some-long-random-text-here
```

Type any long random string. Everything else can stay as-is.

---

## Step 5 — Run it

```bash
npm start
```

You'll see `Kinfold running at http://localhost:3000`. Open that address in your
browser.

- **Cross-reference** tab: search a name like **Samuel / Clemens**, open a match,
  and read the dossier (vitals, bio, relatives).
- **Auto-build** tab: enter a WikiTree ID (or use "Build tree from here" on a
  dossier) to climb the tree and match each person against Wikidata. High-
  confidence matches merge automatically; uncertain ones become questions.
- **Record search** tab: search Open Archives for free Dutch/Belgian/French
  historical records.

Press `Ctrl+C` in the terminal to stop the server.

---

## Troubleshooting

**`node: command not found`** — Node isn't installed or the terminal predates the
install. Reopen the terminal or restart, then retry Step 1's version check.

**`npm start` says a port is in use** — Something else is on port 3000. Set a
different one in `.env`, e.g. `PORT=4000`, and use that address.

**WikiTree returns nothing for a real person** — Only *public* profiles are
visible through the API. Try fewer fields, or a different spelling of the surname.

**Wikidata finds no match for an ordinary ancestor** — Wikidata skews toward
notable people, so everyday ancestors often won't be there. That's expected, not
a bug — the agent simply leaves those as WikiTree-only.

**A Wikidata lookup fails intermittently** — Wikimedia rate-limits aggressive
clients. Kinfold makes calls sequentially and sets a descriptive User-Agent; if
you see occasional failures in the log, they're retried on the next run.
