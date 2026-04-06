/**
 * Factual checklist for EU ETS / MRV responsibility allocation (ISM, DOC holder, charterer).
 * Not legal advice — operators must follow their contracts and EU law.
 */

export const ETS_DELEGATION_CHECKLIST = {
  topic: "EU ETS & MRV responsibility (maritime)",
  items: [
    {
      id: "mrv_shipowner",
      text: "Confirm who is the MRV ‘shipping company’ for each ship (typically shipowner or bareboat charterer per MRV definition).",
    },
    {
      id: "ets_compliance_entity",
      text: "Identify the account holder for EU ETS allowances (EU Maritime Operator Holding Account) and surrender obligations.",
    },
    {
      id: "ism_doc",
      text: "Align with ISM Document of Compliance company and charter party clauses on ETS/FuelEU cost pass-through.",
    },
    {
      id: "pooling",
      text: "If using pooling or third-party management, document data flows and allowance procurement in writing.",
    },
    {
      id: "verification",
      text: "Ensure verified emissions reports (MRV) match operational data before THETIS submission and EUA surrender deadlines.",
    },
  ],
  disclaimer:
    "This checklist is for operational alignment only and does not replace legal or class advice.",
} as const;
