// Exercises every branch of the desktop SQL exporters. Golden outputs are
// stored as snapshots so refactors of the shared dialect core stay byte-exact.
const field = (id, name, type, extra = {}) => ({
  id,
  name,
  type,
  size: "",
  notNull: false,
  primary: false,
  unique: false,
  increment: false,
  default: "",
  comment: "",
  check: "",
  ...extra,
});

export function makeSqlRegressionDiagram() {
  return {
    name: "Regression",
    database: "generic",
    tables: [
      {
        id: "t-customers",
        name: "customers",
        comment: "Customer's master",
        fields: [
          field("c-id", "id", "SMALLINT", { primary: true, notNull: true, increment: true }),
          field("c-code", "code", "CHAR", { size: 8, notNull: true, unique: true }),
          field("c-name", "display_name", "VARCHAR", { size: 5000, default: "O'Brien", comment: "Shown \"as is\"" }),
          field("c-bio", "bio", "TINYTEXT"),
          field("c-avatar", "avatar", "TINYBLOB"),
          field("c-hash", "hash", "BINARY", { size: 32 }),
          field("c-score", "score", "DOUBLE", { default: "-1.5" }),
          field("c-ratio", "ratio", "FLOAT"),
          field("c-born", "born_at", "DATETIME"),
          field("c-alarm", "alarm", "TIME"),
          field("c-flag", "flag", "BIT", { default: "false" }),
          field("c-seen", "last_seen", "TIMESTAMP", { default: "now()", onUpdate: "CURRENT_TIMESTAMP" }),
          field("c-legacy", "legacy_id", "INT", { size: 11, default: "NULL" }),
          field("c-tier", "tier", "ENUM", { values: ["gold", "silver", "it's"], default: "silver" }),
          field("c-role", "role", "role", { notNull: true }),
          field("c-doc", "doc", "JSONB"),
          field("c-num", "balance", "NUMBER", { size: "" }),
          field("c-yr", "since", "YEAR"),
        ],
        indices: [
          { id: 0, name: "idx_customers_name_born", fields: ["display_name", "born_at"], unique: false },
          { id: 1, name: "uq_customers_hash", fields: ["hash"], unique: true },
        ],
      },
      {
        id: "t-invoices",
        name: "invoices_with_a_rather_long_table_name",
        comment: "",
        fields: [
          field("i-id", "id", "INTEGER", { primary: true, notNull: true, increment: true }),
          field("i-cust", "customer_id", "SMALLINT", { notNull: true }),
          field("i-ref", "customer_code", "CHAR", { size: 8 }),
          field("i-total", "total", "NUMERIC", { size: "14,4", check: "total >= 0" }),
          field("i-state", "state", "VARCHAR2", { size: 20, default: "draft" }),
        ],
        indices: [],
      },
      {
        id: "t-lines",
        name: "invoice_lines",
        comment: "",
        fields: [
          field("l-inv", "invoice_id", "INTEGER", { primary: true, notNull: true }),
          field("l-no", "line_no", "INT", { primary: true, notNull: true }),
          field("l-note", "note", "TEXT", { comment: "free text" }),
        ],
        indices: [],
      },
    ],
    relationships: [
      {
        id: "r1",
        startTableId: "t-invoices",
        startFieldId: "i-cust",
        endTableId: "t-customers",
        endFieldId: "c-id",
        cardinality: "one_to_many",
        updateConstraint: "RESTRICT",
        deleteConstraint: "SET NULL",
      },
      {
        id: "r2",
        name: "fk_invoice_customer_code",
        startTableId: "t-invoices",
        startFieldId: "i-ref",
        endTableId: "t-customers",
        endFieldId: "c-code",
        cardinality: "one_to_many",
        updateConstraint: "CASCADE",
        deleteConstraint: "NO ACTION",
      },
      {
        id: "r3",
        startTableId: "t-lines",
        startFieldId: 0,
        endTableId: "t-invoices",
        endFieldId: 0,
        cardinality: "one_to_many",
        updateConstraint: "",
        deleteConstraint: "CASCADE",
      },
    ],
    enums: [
      { name: "role", values: ["admin", "member"] },
      { name: "role", values: ["duplicate"] },
      { name: "empty_enum", values: [] },
    ],
    types: [
      {
        name: "money_type",
        fields: [
          field(0, "amount", "DECIMAL", { size: "10,2" }),
          field(1, "currency", "CHAR", { size: 3 }),
        ],
      },
    ],
  };
}
