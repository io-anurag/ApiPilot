import type { SchemaConstraint, SchemaEvidence } from "@apipilot/shared-domain";
import { EMBEDDED_BODY_MAX_DEPTH } from "../limits";
import { nullProtoRecord, ownEntries, toPlainRecord } from "../jsonSafe";

/**
 * Structural schema inference from observed bodies (specs/056 FR-015, research R16). It infers `type`,
 * `properties`, `items` and `required` only: a value that was merely seen is never turned into an
 * enum, format, range, pattern or length. `required` holds the fields present in every observation.
 * Evidence (presence counts and a type histogram per field) is recorded beside the schema so the test
 * designer can apply its observation threshold without the schema carrying counts.
 */

const MAX_NODES = 2_000;
const MAX_FIELD_PATH_LENGTH = 200;

type JsonType = "string" | "number" | "integer" | "boolean" | "null" | "object" | "array";

interface Node {
  /** Observations of this node (a value at this path, or an element of an array at this path). */
  observed: number;
  /** Histogram of JSON types seen here. */
  types: Record<string, number>;
  /** Observations in which this node was an object (the denominator for child presence). */
  objectObservations: number;
  properties: Map<string, Node>;
  /** The merged shape of array elements seen at this node. */
  items?: Node;
}

function jsonTypeOf(value: unknown): JsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return "object";
}

function newNode(): Node {
  return { observed: 0, types: nullProtoRecord<number>(), objectObservations: 0, properties: new Map() };
}

/** The single non-null type family of a node, or undefined when there is none or they conflict. */
function familyOf(node: Node): { type?: string; conflict: boolean } {
  const families = new Set<string>();
  for (const type of Object.keys(node.types)) {
    if (type === "null") continue;
    families.add(type === "integer" || type === "number" ? "number-ish" : type);
  }
  if (families.size === 0) return { conflict: false };
  if (families.size > 1) return { conflict: true };
  const [only] = families;
  if (only !== "number-ish") return { type: only, conflict: false };
  return { type: node.types.number ? "number" : "integer", conflict: false };
}

export interface InferredBody {
  schema: SchemaConstraint;
  evidence: SchemaEvidence;
  /** Dotted field paths whose observed types conflict. */
  conflicts: string[];
  /** True when the node cap stopped further field discovery. */
  truncated: boolean;
}

export class SchemaInferrer {
  private readonly root = newNode();
  private observations = 0;
  private nodeCount = 1;
  private truncated = false;

  /** Folds one parsed body into the schema. */
  add(value: unknown): void {
    this.observations += 1;
    this.visit(this.root, value, 0);
  }

  private visit(node: Node, value: unknown, depth: number): void {
    node.observed += 1;
    const type = jsonTypeOf(value);
    node.types[type] = (node.types[type] ?? 0) + 1;
    if (depth >= EMBEDDED_BODY_MAX_DEPTH) return;
    if (type === "object") {
      node.objectObservations += 1;
      for (const [key, child] of ownEntries(value as object)) {
        let childNode = node.properties.get(key);
        if (!childNode) {
          if (this.nodeCount >= MAX_NODES) {
            this.truncated = true;
            continue;
          }
          childNode = newNode();
          this.nodeCount += 1;
          node.properties.set(key, childNode);
        }
        this.visit(childNode, child, depth + 1);
      }
    } else if (type === "array") {
      if (!node.items) {
        if (this.nodeCount >= MAX_NODES) {
          this.truncated = true;
          return;
        }
        node.items = newNode();
        this.nodeCount += 1;
      }
      for (const element of value as unknown[]) this.visit(node.items, element, depth + 1);
    }
  }

  build(): InferredBody {
    const conflicts: string[] = [];
    const fields: Record<string, { presentIn: number; types: Record<string, number> }> = nullProtoRecord();

    const buildNode = (node: Node, path: string): SchemaConstraint => {
      const { type, conflict } = familyOf(node);
      if (conflict) {
        conflicts.push(path === "" ? "(body)" : path);
        return { required: [], properties: {} };
      }
      const constraint: SchemaConstraint = { required: [], properties: {} };
      if (type !== undefined) constraint.type = type;
      if (node.properties.size > 0 && node.objectObservations > 0) {
        for (const [key, child] of node.properties) {
          const childPath = path === "" ? key : `${path}.${key}`;
          constraint.properties[key] = buildNode(child, childPath);
          if (childPath.length <= MAX_FIELD_PATH_LENGTH) {
            fields[childPath] = { presentIn: child.observed, types: toPlainRecord(child.types) };
          }
          if (child.observed === node.objectObservations) constraint.required.push(key);
        }
      }
      if (node.items) {
        // Fields of array elements are recorded as `path[].field`; their `presentIn` counts elements, not bodies.
        constraint.items = buildNode(node.items, `${path}[]`);
      }
      return constraint;
    };

    const schema = buildNode(this.root, "");
    return {
      schema,
      evidence: { observations: this.observations, fields: toPlainRecord(fields) },
      conflicts: [...new Set(conflicts)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      truncated: this.truncated,
    };
  }
}
