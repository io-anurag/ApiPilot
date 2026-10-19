import type { SecurityCategory } from "@apipilot/shared-domain";
import { StatusBadge } from "../StatusBadge";
import { TABLE_STYLES } from "../patterns/tableStyles";
import { supportLevelVariant } from "./securityViewModel";

/**
 * The category registry as a semantic table (specs/057 FR-012 to FR-015): each category's documented support
 * level, whether it can be sent to a target in V1, and its taxonomy identifiers with their relation. Support
 * level and taxonomy membership are separate columns on purpose. A mapping marked "related" is ApiPilot's own
 * judgement, not an OWASP statement, and the table says so.
 */
export function CategoryTable({
  categories,
  editionTitle,
}: Readonly<{ categories: readonly SecurityCategory[]; editionTitle: string }>) {
  const hasJudgement = categories.some((category) => category.taxonomy.some((entry) => entry.relation === "related"));
  return (
    <div className="space-y-2" data-testid="category-table">
      <div className={TABLE_STYLES.scroll} tabIndex={0} role="region" aria-label="Security categories">
        <table className={TABLE_STYLES.table}>
          <caption className="sr-only">Security categories, their support level and their {editionTitle} mapping</caption>
          <thead>
            <tr>
              <th scope="col" className={TABLE_STYLES.th}>Category</th>
              <th scope="col" className={TABLE_STYLES.th}>Support level</th>
              <th scope="col" className={TABLE_STYLES.th}>Can run in V1</th>
              <th scope="col" className={TABLE_STYLES.th}>{editionTitle}</th>
              <th scope="col" className={TABLE_STYLES.th}>Limits</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => {
              const level = supportLevelVariant(category.supportLevel);
              return (
                <tr key={category.id} data-testid="category-row" data-category={category.id}>
                  <th scope="row" className={`${TABLE_STYLES.td} text-left font-medium`}>
                    {category.name}
                  </th>
                  <td className={TABLE_STYLES.td}>
                    <StatusBadge label={level.label} tone={level.tone} />
                  </td>
                  <td className={TABLE_STYLES.td}>{category.executable ? "Yes, when its prerequisites are met" : "No"}</td>
                  <td className={TABLE_STYLES.td}>
                    <ul className="flex flex-wrap gap-1.5">
                      {category.taxonomy.map((entry) => (
                        <li key={`${entry.id}-${entry.relation}`} className="rounded border border-border-strong px-1.5 py-0.5 font-mono text-xs">
                          {entry.id}
                          {entry.relation === "related" && <span className="font-sans text-text-secondary"> (related)</span>}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className={`${TABLE_STYLES.td} max-w-md text-text-secondary`}>{category.limitationNote ?? "No restriction beyond its prerequisites."}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasJudgement && (
        <p className="text-xs text-text-secondary">
          “Related” marks ApiPilot’s own judgement where {editionTitle} has no dedicated entry. It is not an OWASP statement.
        </p>
      )}
    </div>
  );
}
