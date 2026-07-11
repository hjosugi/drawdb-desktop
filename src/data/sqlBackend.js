// Optional SQLite backend via tauri-plugin-sql.
import { desktopAvailable } from "../utils/desktopIO";
import { t } from "../i18n/index.js";

let _db = null;
async function sqldb() {
  if (!desktopAvailable()) throw new Error(t("error.sqlBackendRequiresTauri"));
  if (!_db) {
    const { default: Database } = await import("@tauri-apps/plugin-sql");
    _db = await Database.load("sqlite:drawdb.db");
  }
  return _db;
}

export const sqlDiagrams = {
  async list() {
    const db = await sqldb();
    return db.select("SELECT id, diagram_id as diagramId, name, database, last_modified as lastModified FROM diagrams ORDER BY last_modified DESC");
  },
  async get(id) {
    const db = await sqldb();
    const rows = await db.select("SELECT * FROM diagrams WHERE id=$1", [id]);
    return rows[0] ? { id: rows[0].id, ...JSON.parse(rows[0].payload) } : null;
  },
  async add(row) {
    const db = await sqldb();
    const r = await db.execute(
      "INSERT INTO diagrams(diagram_id, name, database, last_modified, payload) VALUES($1,$2,$3,$4,$5)",
      [row.diagramId, row.name, row.database, new Date().toISOString(), JSON.stringify(row)]);
    return r.lastInsertId;
  },
  async update(id, row) {
    const db = await sqldb();
    await db.execute(
      "UPDATE diagrams SET name=$1, database=$2, last_modified=$3, payload=$4 WHERE id=$5",
      [row.name, row.database, new Date().toISOString(), JSON.stringify(row), id]);
  },
  async delete(id) {
    const db = await sqldb();
    await db.execute("DELETE FROM diagrams WHERE id=$1", [id]);
  },
};

export const sqlSettings = {
  async get(key) {
    const db = await sqldb();
    const r = await db.select("SELECT value FROM settings WHERE key=$1", [key]);
    return r[0]?.value;
  },
  async set(key, value) {
    const db = await sqldb();
    await db.execute("INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, value]);
  },
};
