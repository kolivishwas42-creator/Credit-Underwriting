import { useEffect, useState, type ReactNode } from "react";
import { ResultPage } from "../../../shared/components";
import { api, download, openDocument } from "../services/api";
import type { AppConfig, CaseDetail, PlainSummary } from "../types/api";
import { toResultPage, type SummaryState } from "../utils/resultView";

const POLL_MS = 3000;
const POLL_FOR_MS = 150_000;

/**
 * The plain summary of the latest run. While a better-worded text is being prepared (`pending`) the current one is
 * shown and the hook quietly asks again every few seconds.
 */
export function usePlainSummary(caseId: string, runId: string | null): SummaryState {
  const [summary, setSummary] = useState<PlainSummary | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    setSummary(null);
    setError(null);
    if (!runId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const load = () =>
      api.plainSummary(caseId)
        .then((s) => {
          if (stopped) return;
          setSummary(s);
          if (s.pending && Date.now() - started < POLL_FOR_MS) timer = setTimeout(load, POLL_MS);
        })
        .catch((e: Error) => !stopped && setError(e));
    load();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [caseId, runId]);
  return { summary, error };
}

/** The case's result in the common result layout: basic card, summary, checks | calculations, actions. */
export function BankResult({ detail, config, children, onAgency }:
  { detail: CaseDetail; config: AppConfig; children?: ReactNode; onAgency?: () => void }) {
  const id = detail.case.case_id;
  const summary = usePlainSummary(id, detail.latest_run?.run_id ?? null);
  const props = toResultPage(detail, config, summary, {
    downloadPdf: () => { void download(api.reportUrl(id, "pdf"), `bank-verification-${id}.pdf`); },
    printView: () => openDocument(api.reportUrl(id, "html")),
    openAgencyReport: (doc) => openDocument(api.documentUrl(id, doc)),
    goToAgency: onAgency ?? (() => document.getElementById("sec-agency")?.scrollIntoView({ behavior: "smooth", block: "start" })),
  });
  return <ResultPage {...props}>{children}</ResultPage>;
}
