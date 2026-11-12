import { ResultPage } from "../../../shared/components";
import { toResultPage } from "../utils/resultView.js";

function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return "Not available";
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "Not available";

    return value.map((item, index) => (
      <div className="value-line" key={index}>
        {formatValue(item)}
      </div>
    ));
  }

  if (typeof value === "object") {
    return Object.entries(value).map(([key, item]) => (
      <div className="value-line" key={key}>
        <span className="value-key">
          {key.replaceAll("_", " ")} :-
        </span>
        <span className="value-content">
          {formatValue(item)}
        </span>
      </div>
    ));
  }

  return String(value);
}

function ValueDisplay({ value }) {
  return <div className="value-display">{formatValue(value)}</div>;
}

function EvidenceBlock({ title, value }) {
  if (value == null || value === "") return null;

  return (
    <div className="evidence-item">
      <h3>{title}</h3>
      <ValueDisplay value={value} />
    </div>
  );
}

/** The CERSAI and source evidence the report was read into: agent-specific, under the rules and calculations. */
function Evidence({ evidence }) {
  return (
    <section className="card results-section evidence-card">
      <h2>CERSAI and Source Evidence</h2>
      <EvidenceBlock title="Debtor-based search" value={evidence.debtor_search} />
      <EvidenceBlock title="Security-interest details" value={evidence.security_interest} />
      <EvidenceBlock title="Borrower / asset-owner details" value={evidence.asset_owner_evidence} />
      <EvidenceBlock title="Borrower asset-owner Yes/No rows" value={evidence.borrower_asset_owner_rows} />
      <EvidenceBlock title="Owner / Transferor from report header" value={evidence.header_owner} />
      <EvidenceBlock title="Property address" value={evidence.property_address} />
      <details className="raw-evidence">
        <summary>View original extracted PDF text</summary>
        <pre>{evidence.raw_extracted_text || "No extracted text available"}</pre>
      </details>
    </section>
  );
}

/** The result in the console's common result layout; before a run, a one-line empty state. */
export default function ResultsPanel({ result, tolerancePp }) {
  if (!result) {
    return (
      <section className="card empty">
        <h2>No result yet</h2>
        <p>Upload a vendor report and run collateral verification.</p>
      </section>
    );
  }

  return (
    <div className="result-wrap">
      <ResultPage {...toResultPage(result, { tolerancePp })}>
        <Evidence evidence={result.source_evidence || {}} />
      </ResultPage>
    </div>
  );
}
