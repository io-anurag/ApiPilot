import type { ApiModel } from "@apipilot/shared-domain";
import { hash16 } from "../canonical";

/**
 * An **assessment** is the retained work generated for one specification identity (specs/057 research R22): the
 * API's title together with the filename it was loaded as. A specification loaded again under the same title and
 * filename continues the same assessment; one with neither groups under its filename. The label is what the
 * engineer reads, and types back, before deleting an assessment, so it is built from words they recognise.
 */
export interface Assessment {
  readonly key: string;
  readonly label: string;
}

export function assessmentOf(apiModel: Pick<ApiModel, "info">, filename: string | undefined): Assessment {
  const title = apiModel.info?.title?.trim() ?? "";
  const file = filename?.trim() ?? "";
  const label = [title, file].filter((part) => part !== "").join(" · ") || "Untitled specification";
  return { key: hash16([title, file]), label };
}
