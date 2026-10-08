import { createRollforgeServer, listen } from "./server";
import { openWorldDb } from "./db/connection";
import { DocumentStore } from "./db/documentStore";
import { ChatStore } from "./db/chatStore";
import { ensureWorldDir } from "./db/worlds";
import { VERSION } from "./version";
import { dirname, join } from "node:path";

const DATA_DIR = process.env.ROLLFORGE_DATA ?? "data";
const WORLD_ID = process.env.ROLLFORGE_WORLD ?? "default";
const DB_PATH = ensureWorldDir(DATA_DIR, WORLD_ID);

// a single SQLite handle feeds both stores. openWorldDb rejects newer
// schemas and runs migrations on first open.
const db = openWorldDb(DB_PATH);
const store = new DocumentStore(db);
const chatStore = new ChatStore(db);

const server = createRollforgeServer({
  dataDir: DATA_DIR,
  //  images live next to the .db, so a campaign is one folder to copy or back up.
  uploadsDir: join(dirname(DB_PATH), "assets"),
  store,
  chatStore,
});
listen(server, 3000).then((port) => {
  console.log(
    `[rollforge/server] v${VERSION} listening on :${port} (world: ${WORLD_ID}, db: ${DB_PATH})`,
  );
});
