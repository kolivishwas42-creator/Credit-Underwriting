// The two forms of the valuation workflow: what is sent to the vendor (A) and the vendor's response (B).
// `key` is the name the API stores; `label` is what the screen shows.

export type Kind = "text" | "tel" | "number" | "date" | "select" | "check" | "textarea";

export interface FieldDef {
  key: string;
  label: string;
  kind: Kind;
  options?: string[];
  min?: number;
  step?: string;
  /** the field spans the whole row */
  wide?: boolean;
  /** a select without the empty "Select" choice */
  noBlank?: boolean;
}

const t = (key: string): FieldDef => ({ key, label: key, kind: "text" });

/** A. Information sent to vendor (prefilled from LOS) */
export const OUTGOING: FieldDef[] = [
  t("Applicant Name"), t("Verification Agency"), t("Contact person's name"),
  { key: "Contact Number", label: "Contact Number", kind: "tel" },
  t("Property Type"), t("Flat No./House No."), t("Address Line 1"), t("Address Line 2"), t("Landmark"), t("Pincode"),
  t("City"), t("State"),
  { key: "Property Documents Provided", label: "Property Documents Provided", kind: "select", options: ["Yes", "No"], noBlank: true },
  { key: "Copy Of Latest Deed provided", label: "Copy Of Latest Deed provided", kind: "check" },
  { key: "Approved Map", label: "Approved Map", kind: "check" },
  t("Property Owner first name"), t("Property Owner middle name"), t("Property Owner last name"),
  t("Complete Property Address"),
];

const num = (key: string, label = key, min?: number, step = "any"): FieldDef => ({ key, label, kind: "number", min, step });
const sel = (key: string, options: string[], label = key): FieldDef => ({ key, label, kind: "select", options });
const chk = (key: string): FieldDef => ({ key, label: key, kind: "check" });
const UNITS = ["Sq.ft", "Sq.m", "Sq.yd"];

/** B. Vendor inspection and valuation response, in its four sections */
export const VENDOR_SECTIONS: { title: string; grid: string; fields: FieldDef[] }[] = [
  {
    title: "Ownership and address", grid: "grid",
    fields: [t("Current Property Owner"), t("Address As Per Sale Deed"), t("Inspection Address"), t("House No/Flat")],
  },
  {
    title: "Property inspection", grid: "grid four",
    fields: [
      chk("Property Within MC/Not"), chk("Demarcation"), chk("Sanction Plan Provided"), chk("Building As Per Sanction Plan"),
      num("Distance from Branch"),
      sel("Property Usage", ["Rented", "Vacant", "Under Construction", "Residential"]),
      sel("Property Nature As Per Documents", ["Residential", "Commercial", "Mixed Use", "Industrial"]),
      sel("Property Occupancy", ["Rented", "Self Occupied"]),
      num("Number Of Tenants", "Number Of Tenants", 0, "1"),
      t("Type Of Locality"),
      sel("Condition Of Property", ["Poor", "Average", "Good"]),
      num("Residual Age", "Residual Age (years)", 0),
    ],
  },
  {
    title: "Area and valuation", grid: "grid four",
    fields: [
      num("Land Area as per Deed"), sel("Land Area Unit", [...UNITS, "Acres", "Hectares"]), num("Land Rate"),
      num("Built up Area"), sel("Built up Area Unit", UNITS), num("Carpet Area"), sel("Carpet Area Unit", UNITS),
      num("Area Adopted For Valuation"), sel("Area Adopted Unit", UNITS),
      num("Avg construction rate per sq ft"),
      num("Govt. Approved rate(₹)", "Govt. Approved rate (₹)"),
      num("Current Market Value", "Current Market Value (₹)"),
      num("Value to be Considered", "Value to be Considered (₹)"),
      { key: "Valuation Date", label: "Valuation Date", kind: "date" },
      sel("Investment/Self used", ["Self used and tenants", "Self used and rented"]),
      t("Technical Valuation 2"),
    ],
  },
  {
    title: "Vendor status and references", grid: "grid four",
    fields: [
      sel("Final Status", ["Positive", "Negative", "Refer"], "Final Status / Status"),
      { key: "Remarks", label: "Remarks", kind: "textarea", wide: true },
    ],
  },
];

export const VENDOR_FIELDS: FieldDef[] = VENDOR_SECTIONS.flatMap((s) => s.fields);

export const VISIT_TYPES: Record<string, string> = { INITIAL_VISIT: "Initial visit", REVISIT: "Revisit" };

export const SEVERITIES = ["CRITICAL", "MAJOR", "MINOR"];
