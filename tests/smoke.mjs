// Smoke tests for SQL dialects (Oracle / MySQL / PostgreSQL).
// Run with: node tests/smoke.mjs   (exit code 1 on failure)
import { toOracle }   from "../overlay/src/data/exportSQL/oracle.js";
import { toMySQL }    from "../overlay/src/data/exportSQL/mysqlEnhanced.js";
import { toPostgres } from "../overlay/src/data/exportSQL/postgres.js";
import { fromOracle }   from "../overlay/src/data/importSQL/oracle.js";
import { fromMySQL }    from "../overlay/src/data/importSQL/mysqlEnhanced.js";
import { fromPostgres } from "../overlay/src/data/importSQL/postgres.js";

const diagram = {
  name: "Shop", database: "mysql",
  tables: [
    { id: 0, name: "users", fields: [
        { id:0, name:"id", type:"INT", size:"", notNull:true, primary:true, unique:false, increment:true, default:"", comment:"PK" },
        { id:1, name:"email", type:"VARCHAR", size:255, notNull:true, primary:false, unique:true, increment:false, default:"", comment:"" },
        { id:2, name:"status", type:"ENUM", size:"", notNull:true, primary:false, unique:false, increment:false, default:"active", comment:"", values:["active","banned"] },
        { id:3, name:"created", type:"TIMESTAMP", size:"", notNull:true, primary:false, unique:false, increment:false, default:"CURRENT_TIMESTAMP", comment:"" },
      ], indices:[{id:0,name:"idx_email",fields:["email"],unique:true}], comment:"Users table" },
    { id: 1, name: "orders", fields: [
        { id:0, name:"id", type:"BIGINT", size:"", notNull:true, primary:true, unique:false, increment:true, default:"", comment:"" },
        { id:1, name:"user_id", type:"INT", size:"", notNull:true, primary:false, unique:false, increment:false, default:"", comment:"" },
        { id:2, name:"amount", type:"DECIMAL", size:"12,2", notNull:true, primary:false, unique:false, increment:false, default:"0.00", comment:"" },
      ], indices:[], comment:"" },
  ],
  relationships: [{ id:0, name:"fk_orders_user", startTableId:1, startFieldId:1, endTableId:0, endFieldId:0,
    cardinality:"many_to_one", deleteConstraint:"CASCADE", updateConstraint:"NO ACTION" }],
  types:[], enums:[],
};

let failures = 0;
function check(label, cond) {
  if (cond) { console.log(`  PASS  ${label}`); }
  else { console.error(`  FAIL  ${label}`); failures++; }
}

const oracleSql = toOracle(diagram);
const mysqlSql  = toMySQL(diagram);
const pgSql     = toPostgres(diagram);

console.log("=== Oracle ===\n" + oracleSql + "\n");
console.log("=== MySQL ===\n" + mysqlSql + "\n");
console.log("=== PostgreSQL ===\n" + pgSql + "\n");

console.log("--- round-trip: table/relationship counts ---");
for (const [name, from, sql] of [
  ["Oracle", fromOracle, oracleSql],
  ["MySQL", fromMySQL, mysqlSql],
  ["PostgreSQL", fromPostgres, pgSql],
]) {
  const r = from(sql);
  check(`${name}: 2 tables`, r.tables.length === 2);
  check(`${name}: 1 relationship`, r.relationships.length === 1);
  check(`${name}: FK delete=CASCADE`, r.relationships[0]?.deleteConstraint === "CASCADE");
}

console.log("--- PostgreSQL dialect specifics ---");
check("PG: native ENUM type", /CREATE TYPE "users_status" AS ENUM \('active', 'banned'\)/.test(pgSql));
check("PG: SERIAL for INT auto-increment", /"id" SERIAL/.test(pgSql));
check("PG: BIGSERIAL for BIGINT auto-increment", /"id" BIGSERIAL/.test(pgSql));
check("PG: NUMERIC(12,2)", /"amount" NUMERIC\(12,2\)/.test(pgSql));
check("PG: FK ON DELETE CASCADE", /ON DELETE CASCADE/.test(pgSql));
const pgRound = fromPostgres(pgSql);
const statusField = pgRound.tables[0].fields.find(f => f.name === "status");
check("PG: enum column round-trips to ENUM", statusField?.type === "ENUM");
check("PG: enum values preserved", JSON.stringify(statusField?.values) === JSON.stringify(["active","banned"]));
const idField = pgRound.tables[0].fields.find(f => f.name === "id");
check("PG: SERIAL round-trips to increment", idField?.increment === true && idField?.primary === true);
const amount = pgRound.tables[1].fields.find(f => f.name === "amount");
check("PG: NUMERIC size round-trips", amount?.type === "DECIMAL" && String(amount?.size) === "12,2");

console.log(failures === 0 ? "\nALL SMOKE TESTS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
