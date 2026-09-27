import { createRollforgeServer, listen } from "./server";
import { DocumentStore } from "./db/documentStore";
import { ensureWorldDir } from "./db/worlds";
import { VERSION } from "./version";

const DATA_DIR = process.env.ROLLFORGE_DATA ?? "data";
const WORLD_ID = process.env.ROLLFORGE_WORLD ?? "default";
const DB_PATH = ensureWorldDir(DATA_DIR, WORLD_ID);

const server = createRollforgeServer({
  dataDir: DATA_DIR,
  store: new DocumentStore(DB_PATH),
});
listen(server, 3000).then((port) => {
  console.log(
    `[rollforge/server] v${VERSION} listening on :${port} (world: ${WORLD_ID}, db: ${DB_PATH})`,
  );
});