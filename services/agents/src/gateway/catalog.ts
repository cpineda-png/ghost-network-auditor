import type { CatalogResponse } from "contracts";

export const CATALOG: CatalogResponse = {
  templates: [
    {
      templateId: "directory_batch",
      description:
        "Directory listings for one batch, optionally filtered by county and specialty, ordered by listing_id.",
      sources: ["directory"],
      params: [
        { name: "batch", type: "enum", required: true, allowed: ["A", "B"] },
        { name: "county", type: "string", required: false },
        { name: "specialty", type: "string", required: false },
        { name: "limit", type: "integer", required: false },
        { name: "offset", type: "integer", required: false },
      ],
    },
    {
      templateId: "roster_by_npis",
      description: "Roster rows for one to ten NPIs.",
      sources: ["roster"],
      params: [{ name: "npis", type: "npi[]", required: true }],
    },
    {
      templateId: "claims_by_npis",
      description: "Claims counts for one to ten NPIs between two months.",
      sources: ["claims"],
      params: [
        { name: "npis", type: "npi[]", required: true },
        { name: "fromMonth", type: "month", required: true },
        { name: "toMonth", type: "month", required: true },
      ],
    },
  ],
};
