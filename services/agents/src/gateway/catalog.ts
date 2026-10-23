import type { CatalogResponse } from "contracts";

export const CATALOG: CatalogResponse = {
  templates: [
    {
      id: "directory_batch",
      params: [
        { name: "county", type: "string", required: true },
        { name: "specialty", type: "string", required: true },
        { name: "batch", type: "string", required: true },
        { name: "limit", type: "integer", required: false },
      ],
    },
    {
      id: "roster_by_npi",
      params: [{ name: "npis", type: "string[]", required: true }],
    },
    {
      id: "claims_by_npi",
      params: [
        { name: "npis", type: "string[]", required: true },
        { name: "sinceMonth", type: "string", required: true },
      ],
    },
    {
      id: "claims_locations_by_npi",
      params: [
        { name: "npis", type: "string[]", required: true },
        { name: "months", type: "integer", required: true },
      ],
    },
    {
      id: "nppes_individual_by_npi",
      params: [{ name: "npis", type: "string[]", required: true }],
    },
    {
      id: "nppes_org_by_npi",
      params: [{ name: "npis", type: "string[]", required: true }],
    },
  ],
};
