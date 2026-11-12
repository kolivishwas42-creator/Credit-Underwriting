# data/ — synthetic sample documents (no real person or case)

* `itr/input/sample_customer_itr.pdf`, `itr/output/sample_vendor_itr.pdf` / `sample_vendor_itr_mismatch.pdf` — the ITR
  screen verifies documents by NAME from these folders (`ITR_VERIFICATION_LOCAL_INPUT_DIR` / `..._OUTPUT_DIR` in `.env`).
  Try: input `sample_customer_itr.pdf`, output `sample_vendor_itr.pdf` (ACCEPT) or `sample_vendor_itr_mismatch.pdf`
  (REJECT), PAN `ZZQPT1234E`, year `2025-26`, GTI `1250000`.
* `samples/collateral_report_*.txt` — vendor reports for the collateral screen, application `LOS-DUMMY-0018`
  (matching -> PENDING, contradicting -> REFER).
