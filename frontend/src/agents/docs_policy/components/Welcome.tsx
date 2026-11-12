// before a case is open
export function Welcome() {
  return (
    <section className="welcome" id="welcome">
      <div className="welcome-inner">
        <span className="eyebrow">Credit stage</span>
        <h1>Is this loan file ready for underwriting?</h1>
        <p>Enter a case ID on the left. Every person on the loan is checked document by document against the credit
          document policy: what is missing, what is fake or rejected, and what the customer can still be asked for.</p>
        <div className="legend-cards">
          <div className="lc bad"><b>Critical</b><span>A required document is missing, rejected, or does not match (possibly fake). The case goes to the credit manager.</span></div>
          <div className="lc warn"><b>To collect</b><span>On file but old, short, unreadable or still being verified. The case moves ahead; ask the customer.</span></div>
          <div className="lc ok"><b>Verified</b><span>On file and verified. Nothing to do.</span></div>
        </div>
      </div>
    </section>
  );
}
