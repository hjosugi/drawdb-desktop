export function makeShopDiagram() {
  return {
    name: "Shop",
    database: "mysql",
    tables: [
      {
        id: 0,
        name: "users",
        comment: "Users table",
        fields: [
          { id: 0, name: "id", type: "INT", size: "", notNull: true, primary: true, unique: false, increment: true, default: "", comment: "PK", check: "" },
          { id: 1, name: "email", type: "VARCHAR", size: 255, notNull: true, primary: false, unique: true, increment: false, default: "", comment: "", check: "" },
          { id: 2, name: "status", type: "ENUM", size: "", notNull: true, primary: false, unique: false, increment: false, default: "active", comment: "", check: "", values: ["active", "banned"] },
          { id: 3, name: "created", type: "TIMESTAMP", size: "", notNull: true, primary: false, unique: false, increment: false, default: "CURRENT_TIMESTAMP", comment: "", check: "" },
        ],
        indices: [{ id: 0, name: "idx_email", fields: ["email"], unique: true }],
      },
      {
        id: 1,
        name: "orders",
        comment: "",
        fields: [
          { id: 0, name: "id", type: "BIGINT", size: "", notNull: true, primary: true, unique: false, increment: true, default: "", comment: "", check: "" },
          { id: 1, name: "user_id", type: "INT", size: "", notNull: true, primary: false, unique: false, increment: false, default: "", comment: "", check: "" },
          { id: 2, name: "amount", type: "DECIMAL", size: "12,2", notNull: false, primary: false, unique: false, increment: false, default: "0.00", comment: "money", check: "" },
        ],
        indices: [],
      },
    ],
    relationships: [
      {
        id: 0,
        name: "fk_orders_user",
        startTableId: 1,
        startFieldId: 1,
        endTableId: 0,
        endFieldId: 0,
        cardinality: "one_to_many",
        updateConstraint: "NO ACTION",
        deleteConstraint: "CASCADE",
      },
    ],
    enums: [{ name: "role", values: ["admin", "user"] }],
    types: [],
  };
}
