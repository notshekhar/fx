/**
 * Database objects are run through loop's `sql` tool, which reads loop's
 * datasource store (~/.fx/datasources.json under fx's profile) and owns the
 * read-only guard and connection pools. The YAML is the source of truth; the
 * store is rebuilt from it so a deleted Database is gone, not lingering.
 */
import { deleteDatasource, listDatasources, saveDatasource } from "@notshekhar/loop-core";
import { objectsOf, type Registry } from "./registry/store";

export function syncDatasources(registry: Registry): void {
    const databases = objectsOf(registry, "Database");
    const wanted = new Set(databases.map((db) => db.metadata.name));
    for (const { id } of listDatasources()) if (!wanted.has(id)) deleteDatasource(id);
    for (const db of databases) saveDatasource(db.metadata.name, db.spec);
}
