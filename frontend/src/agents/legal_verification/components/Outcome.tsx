import { Alert, Button, Paper, Stack, Text, Textarea, Timeline } from "@mantine/core";
import { IconCircleCheck } from "@tabler/icons-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { api, saveBlob } from "../services/api";
import type { Config, Summary, Workspace } from "../types";
import { toResultPage } from "../utils/resultView";
import { t, when } from "../utils/text";
import { FieldGrid, recoColor, type Act } from "./kit";
import { Pagination, ResultPage, usePagination } from "../../../shared/components";

// ---------------------------------------------------------------------------------------------- the summary
const POLL_MS = 3000;
const POLL_LIMIT = 40;

/** The run's summary in points (AI when it passed the check, else rules-written); polled while the AI writes. */
function useSummary(ws: Workspace, enabled: boolean): Summary | null {
  const [s, setS] = useState<Summary | null>(null);
  const runId = ws.run?.run_id ?? null;
  const id = ws.application.application_id;
  useEffect(() => {
    if (!runId || !enabled) { setS(null); return; }
    let alive = true;
    let tries = 0;
    let timer: number | undefined;
    const load = () => api.summary(id).then((x) => {
      if (!alive) return;
      setS(x);
      if (x.pending && ++tries < POLL_LIMIT) timer = window.setTimeout(load, POLL_MS);
    }).catch(() => { if (alive) setS({ available: false }); });     // a convenience: the points then come from the rules
    load();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [runId, id, enabled]);
  return s;
}

// ---------------------------------------------------------------------------------------------- the result
/**
 * The legal verification result in THE COMMON RESULT LAYOUT: basic card -> summary -> rules | compared values ->
 * actions. "rules" (Automated Rule Results) shows the rules without the summary; "final" (Final Status) shows everything
 * and the decision: the action bar's decision buttons record it, the remarks and the audit history sit under the rules.
 */
export function LegalResult({ ws, config, step, act, busy, onStep }: {
  ws: Workspace; config: Config; step: "rules" | "final"; act: Act; busy: string | null; onStep: (s: "report" | "final") => void;
}) {
  const id = ws.application.application_id;
  const summary = useSummary(ws, step === "final");
  const [remarks, setRemarks] = useState("");
  const [missing, setMissing] = useState(false);                    // a decision was pressed without its remarks
  const remarksRef = useRef<HTMLTextAreaElement>(null);

  // the decision buttons: the same check and the same call as the old "Submit decision"
  const decide = async (decision: string) => {
    const spec = config.decisions.find((d) => d.id === decision);
    if (spec?.remarks_required && !remarks.trim()) {
      setMissing(true);
      remarksRef.current?.focus();
      remarksRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      return;
    }
    setMissing(false);
    await act("decide", () => api.decide(id, decision, remarks), t("decision.recorded"));
  };
  const props = toResultPage({
    ws, config, summary, step, busy: !!busy,
    handlers: {
      decide,
      download: () => { act("download", async () => saveBlob(await api.reportBlob(id), `legal-verification-${id}.pdf`), t("case.downloaded")); },
      validate: () => { act("validate", () => api.validate(id), t("case.validated")); },
      openFinal: () => onStep("final"),
    },
  });

  return (
    <ResultPage {...props} detailsOpen={step === "final"}>   {/* the decision remarks are in there */}
      {step === "rules" && !ws.run && ws.agency_report === null && (
        <Button variant="light" w="fit-content" onClick={() => onStep("report")}>{t("sections.report")}</Button>
      )}
      {step === "final" && (
        <DecisionPanel ws={ws} config={config} remarks={remarks} missing={missing} remarksRef={remarksRef}
                       setRemarks={(v) => { setRemarks(v); if (v.trim()) setMissing(false); }} />
      )}
    </ResultPage>
  );
}

// ---------------------------------------------------------------------------------------------- the decision
/** The decision's state and its remarks (the decision buttons are in the action bar), and the audit history, paged. */
function DecisionPanel({ ws, config, remarks, setRemarks, missing, remarksRef }: {
  ws: Workspace; config: Config; remarks: string; setRemarks: (v: string) => void; missing: boolean;
  remarksRef: RefObject<HTMLTextAreaElement>;
}) {
  const [all, setAll] = useState(false);
  const reco = ws.run?.overview.recommendation;
  const limit = config.ui.activity_visible ?? 6;
  const events = all ? ws.events : ws.events.slice(0, limit);
  const pager = usePagination(events);
  const needRemarks = config.decisions.filter((d) => d.remarks_required).map((d) => d.label);
  const proceedBlocked = !!reco && !config.proceed_allowed_for.includes(reco);

  return (
    <div className="decision-split">
      <Paper withBorder radius="lg" p="lg" className="decision-box">
        <Text fw={800} mb={4}>{t("decision.title")}</Text>
        <Text size="sm" c="dimmed" mb="sm">{t("decision.subtitle")}</Text>
        {ws.case.status === "DECIDED" ? (
          <Alert color="green" icon={<IconCircleCheck />} title={ws.case.decision_label}>
            {t("decision.by", { who: ws.case.decided_by ?? "—", when: when(ws.case.decided_at) })}
            {ws.case.decision_remarks && <Text size="sm" mt={4}>{ws.case.decision_remarks}</Text>}
          </Alert>
        ) : ws.case.status === "WAIVED" ? (
          <Alert color="orange" title={t("actions.waived_title")}>
            {t("actions.waived_by", { who: ws.case.waived_by ?? "—", when: when(ws.case.waived_at) })}
            <Text size="sm" mt={4}>{ws.case.waive_reason}</Text>
          </Alert>
        ) : !ws.can.decide ? (
          <Text size="sm" c="dimmed">{!ws.run ? t("decision.validate_first")
            : ws.case.status !== "VALIDATED" ? t("decision.rules_pending") : t("decision.no_permission")}</Text>
        ) : (
          <Stack gap="xs">
            <Textarea ref={remarksRef} label={t("decision.remarks")} withAsterisk={missing} value={remarks} autosize minRows={2}
                      onChange={(e) => setRemarks(e.currentTarget.value)} placeholder={t("decision.remarks_hint")}
                      description={needRemarks.length ? `${needRemarks.join(" · ")}: ${t("decision.remarks_needed")}` : undefined}
                      error={missing ? t("decision.remarks_required") : undefined} />
            {proceedBlocked && <Text size="xs" c="red">{t("decision.blocked")}</Text>}
          </Stack>
        )}
      </Paper>
      <Paper withBorder radius="lg" p="lg" className="audit-box">
        <Text size="xs" fw={800} tt="uppercase" c="dimmed" mb="xs">{t("audit.title")}</Text>
        {ws.events.length === 0 ? <Text size="sm" c="dimmed">{t("audit.none")}</Text> : (
          <Timeline active={pager.rows.length} bulletSize={14} lineWidth={2} color="sapphire">
            {pager.rows.map((e) => (
              <Timeline.Item key={e.event_id} title={<Text size="sm" fw={700}>{e.label}{e.detail && <Text span c="dimmed" fw={500}> · {e.detail}</Text>}</Text>}>
                <Text size="xs" c="dimmed">{e.actor} · {when(e.at)}</Text>
              </Timeline.Item>
            ))}
          </Timeline>
        )}
        <Pagination pager={pager} noun="events" />
        {ws.events.length > limit && <Button variant="subtle" size="compact-xs" w="fit-content" mt="xs" onClick={() => setAll(!all)}>
          {all ? t("audit.less") : t("audit.all", { n: ws.events.length })}</Button>}
      </Paper>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- geo location
export function GeoLocation({ ws }: { ws: Workspace }) {
  const geo = ws.application.geo;
  if (!geo.some((g) => g.value)) return <Text size="sm" c="dimmed">{t("geo.none")}</Text>;
  return <FieldGrid items={geo.map((g) => ({ id: g.id, label: g.label, value: g.value, wide: g.id === "geo_address" }))}
                    cols={{ base: 1, sm: 2, lg: 4 }} />;
}

export { recoColor };
