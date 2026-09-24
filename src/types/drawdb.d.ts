// Shared shape of drawDB diagrams as used by the desktop modules, the .ddb
// file format, the SQL/Excel converters, and the headless CLI.
//
// JavaScript files opt into checking through tsconfig.json (`npm run
// typecheck`) and reference these types with JSDoc, e.g.
//   /** @param {import("../types/drawdb").Diagram} diagram */

/** Table, field, and relationship ids: upstream uses strings, legacy files numbers. */
export type EntityId = string | number;

export type ReferentialAction =
  | "NO ACTION"
  | "CASCADE"
  | "SET NULL"
  | "SET DEFAULT"
  | "RESTRICT"
  | (string & {});

export type Cardinality = "one_to_one" | "one_to_many" | "many_to_one" | (string & {});

export interface Field {
  id: EntityId;
  name: string;
  /** Upper-case SQL type name, or the name of a diagram enum / composite type. */
  type: string;
  /** Length or precision, e.g. 255 or "12,2". Empty when unused. */
  size?: string | number;
  default?: string;
  check?: string;
  comment?: string;
  primary?: boolean;
  unique?: boolean;
  notNull?: boolean;
  increment?: boolean;
  /** Allowed values for ENUM / SET columns. */
  values?: string[];
  /** MySQL ON UPDATE expression. */
  onUpdate?: string;
}

export interface Index {
  id: EntityId;
  name: string;
  /** Column names. */
  fields: string[];
  unique?: boolean;
}

export interface Table {
  id: EntityId;
  name: string;
  x?: number;
  y?: number;
  fields: Field[];
  indices?: Index[];
  comment?: string;
  color?: string;
  locked?: boolean;
}

export interface Relationship {
  id: EntityId;
  name?: string;
  startTableId: EntityId;
  startFieldId: EntityId;
  endTableId: EntityId;
  endFieldId: EntityId;
  cardinality?: Cardinality;
  updateConstraint?: ReferentialAction;
  deleteConstraint?: ReferentialAction;
}

export interface EnumDefinition {
  name: string;
  values: string[];
}

export interface CompositeType {
  name: string;
  fields: Field[];
  comment?: string;
}

export interface Note {
  id: EntityId;
  x: number;
  y: number;
  title?: string;
  content?: string;
  color?: string;
  height?: number;
}

export interface Area {
  id: EntityId;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}

export interface Transform {
  zoom: number;
  pan: { x: number; y: number };
}

/** In-memory diagram accepted by the converters. */
export interface Diagram {
  diagramId?: string;
  name?: string;
  database?: string;
  tables: Table[];
  relationships: Relationship[];
  notes?: Note[];
  areas?: Area[];
  types?: CompositeType[];
  enums?: EnumDefinition[];
  todos?: unknown[];
  transform?: Transform;
  lastModified?: string | Date;
}

/** Normalized payload written to .ddb files (see src/utils/ddb.js). */
export interface DdbPayload extends Diagram {
  $format: "drawdb-file";
  $version: 1;
  name: string;
  title: string;
  database: string;
  lastModified: string;
  notes: Note[];
  areas: Area[];
  subjectAreas: Area[];
  types: CompositeType[];
  enums: EnumDefinition[];
  todos: unknown[];
  transform: Transform;
}

/** Result of validateDdbDiagram(). */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Result of the desktop SQL importers. */
export interface ImportedSchema {
  tables: Table[];
  relationships: Relationship[];
}
