import { ResultPage } from "../../../shared/components";
import type { CheckResult } from "../types";
import { toResultPage, type EligibilityContext } from "../utils/resultView";

/** the result in the console's common layout: basic card, summary, checks | figures, actions */
export function ResultCard({ r, ctx }: { r: CheckResult; ctx?: EligibilityContext }) {
  return (
    <div id="result">
      <ResultPage {...toResultPage(r, ctx)} />
    </div>
  );
}
