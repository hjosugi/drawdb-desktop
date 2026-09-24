import { describe, expect, it } from "vitest";
import { toMSSQL } from "../src/data/exportSQL/mssql.js";
import { fromMSSQL } from "../src/data/importSQL/mssql.js";
import { detectSqlDialect, normalizeEditorDatabase } from "../src/desktop/diagram.js";
import { makeShopDiagram } from "./fixtures/shopDiagram.mjs";

const pick = (field) => ({
  name: field.name,
  type: field.type,
  notNull: !!field.notNull,
  primary: !!field.primary,
  unique: !!field.unique,
  increment: !!field.increment,
  default: String(field.default ?? ""),
  comment: field.comment || "",
  ...(field.values ? { values: field.values } : {}),
});

describe("SQL Server (T-SQL) dialect", () => {
  it("emits IDENTITY, NVARCHAR, CHECK enums, extended-property comments, and FK actions", () => {
    const sql = toMSSQL(makeShopDiagram());

    expect(sql).toContain("[id] INT IDENTITY(1,1) NOT NULL,");
    expect(sql).toContain("[email] NVARCHAR(255) NOT NULL UNIQUE,");
    expect(sql).toContain("[status] NVARCHAR(10) NOT NULL DEFAULT N'active',");
    expect(sql).toContain("[created] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,");
    expect(sql).toContain("CONSTRAINT [CK_users_status_enum] CHECK ([status] IN (N'active', N'banned'))");
    expect(sql).toContain("@name = N'MS_Description', @value = N'Users table',");
    expect(sql).toContain("@level2type = N'COLUMN', @level2name = N'amount';");
    expect(sql).toContain("CREATE UNIQUE INDEX [idx_email] ON [users] ([email]);");
    expect(sql).toContain("ALTER TABLE [orders] ADD CONSTRAINT [fk_orders_user] FOREIGN KEY ([user_id]) REFERENCES [users] ([id]) ON DELETE CASCADE;");
  });

  it("round-trips two tables with a FK, an enum, and comments without loss", () => {
    const diagram = makeShopDiagram();
    const result = fromMSSQL(toMSSQL(diagram));

    expect(result.tables.map((table) => table.name)).toEqual(["users", "orders"]);
    diagram.tables.forEach((table, index) => {
      const imported = result.tables[index];
      expect(imported.comment).toBe(table.comment);
      expect(imported.fields.map(pick)).toEqual(table.fields.map((field) => ({
        ...pick(field),
        // T-SQL has no TIMESTAMP-with-time-zone distinction; DATETIME2 reads back as DATETIME.
        type: field.type === "TIMESTAMP" ? "DATETIME" : field.type,
      })));
      expect(imported.indices).toEqual(table.indices);
    });
    expect(result.relationships).toEqual([expect.objectContaining({
      name: "fk_orders_user",
      startTableId: 1,
      startFieldId: 1,
      endTableId: 0,
      endFieldId: 0,
      deleteConstraint: "CASCADE",
      updateConstraint: "NO ACTION",
    })]);
  });

  it("maps generic types, drops unsupported RESTRICT, and writes computed columns", () => {
    const field = (id, name, type, extra = {}) => ({ id, name, type, size: "", ...extra });
    const sql = toMSSQL({
      name: "Types",
      tables: [
        {
          id: 0,
          name: "t",
          fields: [
            field(0, "id", "UUID", { primary: true, notNull: true, default: "NEWID()" }),
            field(1, "flag", "BOOLEAN", { default: "true" }),
            field(2, "body", "TEXT"),
            field(3, "blob", "BLOB"),
            field(4, "big", "VARCHAR", { size: 9000 }),
            field(5, "price", "DECIMAL", { size: "10,2" }),
            field(6, "total", "DECIMAL", { generated: { expression: "[price] * 2", stored: true }, notNull: true }),
            field(7, "shape", "POINT"),
          ],
          indices: [],
        },
        { id: 1, name: "u", fields: [field(0, "t_id", "UUID")], indices: [] },
      ],
      relationships: [{
        id: 0, startTableId: 1, startFieldId: 0, endTableId: 0, endFieldId: 0,
        deleteConstraint: "RESTRICT", updateConstraint: "SET NULL",
      }],
    });

    expect(sql).toContain("[id] UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),");
    expect(sql).toContain("[flag] BIT DEFAULT 1,");
    expect(sql).toContain("[body] NVARCHAR(MAX),");
    expect(sql).toContain("[blob] VARBINARY(MAX),");
    expect(sql).toContain("[big] NVARCHAR(MAX),");
    expect(sql).toContain("[total] AS ([price] * 2) PERSISTED NOT NULL,");
    expect(sql).toContain("[shape] GEOMETRY,");
    expect(sql).toContain("REFERENCES [t] ([id]) ON UPDATE SET NULL;");

    const imported = fromMSSQL(sql).tables[0].fields;
    expect(imported.find((f) => f.name === "total")).toMatchObject({
      generated: { expression: "[price] * 2", stored: true },
      notNull: true,
    });
    expect(imported.find((f) => f.name === "id")).toMatchObject({ type: "UUID", default: "NEWID()" });
    expect(imported.find((f) => f.name === "body")).toMatchObject({ type: "TEXT" });
  });

  it("reads SSMS 'Script Table as' output", () => {
    const script = `
USE [Shop]
GO
SET ANSI_NULLS ON
GO
CREATE TABLE [dbo].[Customers](
\t[CustomerID] [int] IDENTITY(1,1) NOT NULL,
\t[Name] [nvarchar](100) NOT NULL,
\t[Tier] [varchar](10) NULL,
\t[Balance] [money] NULL,
\t[Created] [datetime2](7) NOT NULL,
 CONSTRAINT [PK_Customers] PRIMARY KEY CLUSTERED
(
\t[CustomerID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO
CREATE TABLE [dbo].[Orders](
\t[OrderID] [bigint] IDENTITY(1,1) NOT NULL,
\t[CustomerID] [int] NOT NULL,
\t[Total] [decimal](12, 2) NOT NULL,
 CONSTRAINT [PK_Orders] PRIMARY KEY CLUSTERED ([OrderID] ASC)
) ON [PRIMARY]
GO
ALTER TABLE [dbo].[Customers] ADD  CONSTRAINT [DF_Customers_Created]  DEFAULT (sysdatetime()) FOR [Created]
GO
ALTER TABLE [dbo].[Customers] ADD  DEFAULT ('bronze') FOR [Tier]
GO
ALTER TABLE [dbo].[Orders]  WITH CHECK ADD  CONSTRAINT [FK_Orders_Customers] FOREIGN KEY([CustomerID])
REFERENCES [dbo].[Customers] ([CustomerID])
ON DELETE CASCADE
GO
ALTER TABLE [dbo].[Orders] CHECK CONSTRAINT [FK_Orders_Customers]
GO
ALTER TABLE [dbo].[Customers]  WITH CHECK ADD  CONSTRAINT [CK_Customers_Tier] CHECK  (([Tier]='gold' OR [Tier]='bronze'))
GO
CREATE NONCLUSTERED INDEX [IX_Orders_Customer] ON [dbo].[Orders]
(
\t[CustomerID] ASC
)WITH (SORT_IN_TEMPDB = OFF) ON [PRIMARY]
GO
EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=N'Customer master' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'Customers'
GO
EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=N'顧客名' , @level0type=N'SCHEMA',@level0name=N'dbo', @level1type=N'TABLE',@level1name=N'Customers', @level2type=N'COLUMN',@level2name=N'Name'
GO
`;
    const result = fromMSSQL(script);
    const [customers, orders] = result.tables;

    expect(result.tables.map((table) => table.name)).toEqual(["Customers", "Orders"]);
    expect(customers.comment).toBe("Customer master");
    expect(customers.fields.map((f) => [f.name, f.type, f.size, f.primary, f.increment, f.default])).toEqual([
      ["CustomerID", "INT", "", true, true, ""],
      ["Name", "VARCHAR", "100", false, false, ""],
      ["Tier", "VARCHAR", "10", false, false, "bronze"],
      ["Balance", "DECIMAL", "19,4", false, false, ""],
      ["Created", "DATETIME", "", false, false, "CURRENT_TIMESTAMP"],
    ]);
    expect(customers.fields[1].comment).toBe("顧客名");
    expect(customers.fields[2].check).toBe("[Tier]='gold' OR [Tier]='bronze'");
    expect(orders.fields.find((f) => f.name === "Total")).toMatchObject({ type: "DECIMAL", size: "12, 2" });
    expect(orders.indices).toEqual([{ id: 0, name: "IX_Orders_Customer", fields: ["CustomerID"], unique: false }]);
    expect(result.relationships).toEqual([expect.objectContaining({
      name: "FK_Orders_Customers",
      startTableId: 1,
      endTableId: 0,
      deleteConstraint: "CASCADE",
    })]);
  });

  it("accepts inline references, positional extended properties, and invalid input", () => {
    const result = fromMSSQL(`
      CREATE TABLE a (id INT PRIMARY KEY);
      CREATE TABLE b (a_id INT NOT NULL REFERENCES dbo.a (id) ON UPDATE CASCADE, CONSTRAINT UQ_b UNIQUE (a_id));
      EXEC sp_addextendedproperty N'MS_Description', N'child', N'SCHEMA', N'dbo', N'TABLE', N'b';
    `);

    expect(result.tables[1]).toMatchObject({ comment: "child" });
    expect(result.tables[1].fields[0]).toMatchObject({ unique: true, notNull: true });
    expect(result.relationships[0]).toMatchObject({ name: "FK_b_a_id", updateConstraint: "CASCADE" });
    expect(fromMSSQL("not sql at all")).toEqual({ tables: [], relationships: [] });
  });

  it("is detected from T-SQL markers and opened as a transactsql diagram", () => {
    expect(detectSqlDialect(toMSSQL(makeShopDiagram()))).toBe("mssql");
    expect(detectSqlDialect("CREATE TABLE [dbo].[x] ([id] int)\nGO")).toBe("mssql");
    expect(detectSqlDialect("CREATE TABLE t (id UNIQUEIDENTIFIER)")).toBe("mssql");
    expect(detectSqlDialect("CREATE TABLE t (name NVARCHAR2(10))")).toBe("oracle");
    expect(detectSqlDialect("CREATE TABLE t (id SERIAL)")).toBe("postgres");
    expect(normalizeEditorDatabase("mssql")).toBe("transactsql");
  });
});
