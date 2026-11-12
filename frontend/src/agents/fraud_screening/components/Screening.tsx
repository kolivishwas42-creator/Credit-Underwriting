// AML and PEP screening: side-by-side comparison of the application and each listed record.
import type { ScreenKind, ScreenRecord, Screening } from "../types";
import { Pagination, usePagination } from "../../../shared/components";
import { AML_LABEL, GAUGE_YELLOW_BAND, SCREENS, gaugeColour, gaugePoint, linkHost, threshold } from "../utils/screening";

function Lines({ list }: { list?: string[] | null }) {
  if (!list || !list.length) return <div className="muted">&mdash;</div>;
  return <>{list.map((l, i) => <div key={i}>{l}</div>)}</>;
}

/** the match score as a semicircle; the exact value is in the hover text and for screen readers */
export function ScoreGauge({ percent, threshold: th }: { percent?: number | null; threshold?: number }) {
  if (percent === null || percent === undefined || isNaN(Number(percent))) return <span className="gauge-na">no score</span>;
  const p = Math.max(0, Math.min(100, Number(percent)));
  const t = threshold(th);
  const label = `Match score ${p}% (threshold ${t}%)`;
  const end = gaugePoint(p, 40), t1 = gaugePoint(t, 31), t2 = gaugePoint(t, 49);
  return (
    <svg className="gauge" viewBox="0 0 100 56" role="img" aria-label={label}>
      <title>{label}</title>
      <path className="gauge-track" d="M10 50 A40 40 0 0 1 90 50" />
      {p > 0 && <path className={"gauge-fill " + gaugeColour(p, t)} d={`M10 50 A40 40 0 0 1 ${end[0]} ${end[1]}`} />}
      <line className="gauge-tick" x1={t1[0]} y1={t1[1]} x2={t2[0]} y2={t2[1]} />
    </svg>
  );
}

function GaugeLegend({ threshold: th }: { threshold?: number }) {
  const t = threshold(th);
  const lo = Math.max(0, t - GAUGE_YELLOW_BAND);
  return (
    <p className="legend">
      Match score: <i className="g-green"></i>below {lo}%<i className="g-yellow"></i>{lo}&ndash;{t}%
      <i className="g-red"></i>{t}% and above (higher means a closer match to a listed record)
    </p>
  );
}

function AmlRecord({ v, factsOpen, recordLabel, threshold: th }: {
  v: ScreenRecord; factsOpen: boolean; recordLabel: string; threshold?: number;
}) {
  const sub = [v.agency, v.list_type].filter(Boolean).map((x) => String(x).replace(/_/g, " ")).join(" · ");
  const facts = v.facts || [];
  const links = (v.source_links || []).map((u) => ({ u, host: linkHost(u) })).filter((l) => l.host);
  return (
    <div className="aml-rec">
      <div className="aml-head">
        <ScoreGauge percent={v.match_percent} threshold={th} />
        <span className="aml-name">{v.name}<small>{sub}</small></span>
        {(v.matched_fields || []).map((f, i) => <span key={"m" + i} className="tag match">{f} &#10003;</span>)}
        {(v.partial_fields || []).map((f, i) => <span key={"p" + i} className="tag partial">{f} ~</span>)}
        {(v.tags || []).map((t, i) => <span key={"t" + i} className="tag">{t}</span>)}
      </div>
      <div className="cmp-row cmp-hdr"><div>Check</div><div>Application</div><div>{recordLabel}</div><div>Result</div></div>
      {(v.comparison || []).map((c, i) => (
        <div key={i} className={"cmp-row st-" + c.status}>
          <div className="cmp-field">{c.field}</div>
          <div className="cmp-cell" data-label="Application"><Lines list={c.applicant} /></div>
          <div className="cmp-cell" data-label={recordLabel}><Lines list={c.record} /></div>
          <div>
            <span className="st">{AML_LABEL[c.status] || c.status}</span>
            {c.note && <div className="cmp-note">{c.note}</div>}
          </div>
        </div>
      ))}
      {(facts.length > 0 || links.length > 0) && (
        <details className="aml-extra" open={factsOpen}>
          <summary>Record details</summary>
          <dl className="facts">
            {facts.map((f, i) => [<dt key={"dt" + i}>{f.label}</dt>, <dd key={"dd" + i}>{String(f.value ?? "")}</dd>])}
            {links.length > 0 && (
              <>
                <dt>Source</dt>
                <dd>
                  {links.map((l, i) => (
                    <span key={i}>{i > 0 && ", "}<a href={l.u} target="_blank" rel="noopener noreferrer">{l.host}</a></span>
                  ))}
                </dd>
              </>
            )}
          </dl>
        </details>
      )}
    </div>
  );
}

function ScreeningCard({ kind, data }: { kind: ScreenKind; data: Screening }) {
  const sc = SCREENS[kind];
  const strong = data.strong_matches || [], other = data.other_matches || [];
  // every record, one to a page: the matches at or above the threshold first, then the lower-scoring ones
  const records = [...strong.map((v) => ({ v, strong: true })), ...other.map((v) => ({ v, strong: false }))];
  const pager = usePagination(records, 1);
  const t = `${data.threshold_percent ?? ""}%`;
  const sample = data.source === "mock" && (
    <div className="banner medium" style={{ marginBottom: 10 }}>
      <span className="msg">
        Sample data: {sc.urlVar} is not set, so these records come from {sc.sampleFile} and are not real results for this applicant.
      </span>
    </div>
  );
  const rid = data.request_id ? <p className="hint">Vendor request ID: {data.request_id}</p> : null;
  if (!strong.length && !other.length) {
    return (
      <div className="card">
        <h2>{sc.title}</h2>
        {sample}
        <div className="banner low">
          <span className="badge big low">NO MATCH</span>
          <span className="msg">No records matched this applicant.</span>
        </div>
        <div className="empty">No records matched, so there is nothing to compare.</div>
        {rid}
      </div>
    );
  }
  const level = strong.length ? "high" : "low";
  return (
    <div className="card">
      <h2>{sc.title}</h2>
      {sample}
      <div className={"banner " + level}>
        <span className={"badge big " + level}>{strong.length ? sc.badge : "NO STRONG MATCH"}</span>
        <span className="msg">{data.summary}</span>
      </div>
      <div className="stats">
        <div className="stat trig"><b>{strong.length}</b><span>At or above {t}</span></div>
        <div className="stat skip"><b>{other.length}</b><span>Below {t}</span></div>
        <div className="stat"><b>{String(data.total_records ?? "")}</b><span>Records from vendor</span></div>
      </div>
      <GaugeLegend threshold={data.threshold_percent} />
      {pager.rows.map((r) => (
        <div key={pager.from}>
          <h3 className="aml-h">{r.strong ? `Match at or above ${t}` : `Lower-scoring record (below ${t})`}</h3>
          <AmlRecord v={r.v} factsOpen recordLabel={sc.recordLabel} threshold={data.threshold_percent} />
        </div>
      ))}
      <Pagination pager={pager} noun="records" fixedSize />
      {rid}
    </div>
  );
}

/** a screening tab: not run, failed, or the comparison plus the raw JSON */
export function ScreenTab({ kind, data }: { kind: ScreenKind; data: Screening | null | undefined }) {
  const title = SCREENS[kind].title;
  if (!data) return <div className="card"><h2>{title}</h2><div className="empty">Not run yet.</div></div>;
  if (data.error || data.status === "error") {
    return <div className="card"><h2>{title}</h2><div className="error">{data.error || JSON.stringify(data)}</div></div>;
  }
  return (
    <>
      <ScreeningCard kind={kind} data={data} />
      <div className="card">
        <details><summary>Raw JSON response</summary><pre>{JSON.stringify(data, null, 2)}</pre></details>
      </div>
    </>
  );
}
