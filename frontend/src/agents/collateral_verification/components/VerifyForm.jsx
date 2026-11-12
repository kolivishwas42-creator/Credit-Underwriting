export default function VerifyForm({
  applicationNumber,
  setApplicationNumber,
  finalStatus,
  setFinalStatus,
  statuses,
  file,
  setFile,
  busy,
  error,
  onSubmit,
}) {
  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>Verify a report</h2>
      <label htmlFor="application_number">Application number or id</label>
      <input
        id="application_number"
        value={applicationNumber}
        onChange={(e) => setApplicationNumber(e.target.value)}
        required
      />
      <label htmlFor="final_status">Vendor final status</label>
      <select id="final_status" value={finalStatus} onChange={(e) => setFinalStatus(e.target.value)}>
        {statuses.map((status) => (
          <option key={status} value={status}>{status}</option>
        ))}
      </select>
      <label htmlFor="report">Vendor report</label>
      <input
        id="report"
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.odg,.txt"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />
      <div className="actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Checking…" : "Run verification"}
        </button>
      </div>
      <p className="hint">
        {file ? file.name : "PDF, image, or ODG: the title-search and CERSAI report."}
      </p>
      {error ? <p className="err" role="alert">{error}</p> : null}
    </form>
  );
}
