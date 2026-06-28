# Setup guide — running Kinfold on your computer

This walks through everything from zero. No prior Node.js experience assumed.
Plan for ~5 minutes.

Kinfold needs **no API keys and no accounts**. Open Archives, Chronicling America,
and the Internet Archive are all free and anonymous.

---

## Step 1 — Install Node.js

Kinfold needs Node.js version 18 or newer.

1. Go to https://nodejs.org and download the **LTS** version.
2. Run the installer with the default options.
3. Confirm it worked. Open a terminal (macOS: Terminal; Windows: PowerShell) and run:

   ```bash
   node --version
   ```

   You should see something like `v20.x.x`. If the number is 18 or higher, you're
   set. If the command isn't found, close and reopen the terminal, or restart your
   computer so the install registers.

---

## Step 2 — Get the project onto your computer

If you already have the project folder, just note where it is. If it's in a Git
repository:

```bash
git clone <your-repo-url>
cd kinfold
```

Either way, open a terminal **in the project folder** — the one containing
`package.json`. To check you're in the right place:

```bash
ls
```

You should see `package.json`, `server`, `public`, and `README.md`.

---

## Step 3 — Install the project's dependencies

This downloads the two libraries Kinfold uses (Express, dotenv) into a local
`node_modules` folder. Run:

```bash
npm install
```

It prints a summary when done. A `node_modules` folder now exists — you never edit
it, and it's already excluded from Git.

---

## Step 4 — (Optional) Create your settings file

Kinfold runs with sensible defaults, so this step is optional. To customize the port,
copy the template `.env.example` to `.env`:

macOS / Linux:

```bash
cp .env.example .env
```

Windows (PowerShell):

```powershell
Copy-Item .env.example .env
```

The only setting worth changing is `PORT` (default 3000). There are no keys or
secrets to fill in.

---

## Step 5 — Run it

```bash
npm start
```

You'll see `Kinfold running at http://localhost:3000`. Open that address in your
browser.

1. Enter a name — at least a surname (try **Samuel / Clemens**). Optionally add a
   place and a year range.
2. Tick the sources you want and press **Search archives**.
3. Browse the findings grouped by source, follow **View source** to the original
   document, and use **Export CSV** to save your research log.

Press `Ctrl+C` in the terminal to stop the server.

---

## Troubleshooting

**`node: command not found`** — Node isn't installed or the terminal predates the
install. Reopen the terminal or restart, then retry Step 1's version check.

**`npm start` says a port is in use** — Something else is on port 3000. Set a
different one in `.env`, e.g. `PORT=4000`, and use that address.

**A source shows "unavailable"** — Each search calls live archive APIs. If one is
down or rate-limiting, only that source's group reports the error; the others still
return results. Try again in a moment.

**No matches at all** — Widen your search: just a surname, drop the place, or expand
the year range. Some sources are regional (Open Archives is NL/BE/FR; Chronicling
America is US newspapers), so a person may only appear in one of them.

**A common name returns noise** — Add a place and a tight year range; both feed the
relevance score and push the most likely records to the top of each source.
