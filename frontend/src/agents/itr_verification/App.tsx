import { AgentFrame } from '../../shared/components'
import { useState, useEffect } from 'react'
import {
  FileCheck2,
  Loader2,
  Settings,
  RefreshCw,
  Search,
  Shuffle,
} from 'lucide-react'
import { SettingsModal } from './components/SettingsModal'
import { RulesConfigTab } from './components/RulesConfigTab'
import { fetchParticipants, fetchSampleDocuments, verifyByIds } from './api/client'
import { BackToForm, FormArea, ResultPage, useAgentLoader, useResultScreen } from '../../shared/components'
import { toResultPage } from './utils/resultView'
import { downloadReport } from './utils/downloadReport'
import type { ApplicationParticipants, VerificationResponse } from './types'

/** For testing: fill the two document names with a random file of the backend's local input / output folders (data/itr)
 *  when the screen opens, and offer a button to pick another pair. false = no automatic fill (the button stays). */
const PREFILL_SAMPLE_DOCUMENTS = true
const randomOf = (names: string[]) => names[Math.floor(Math.random() * names.length)]

type Person = ApplicationParticipants['participants'][number]
const personLabel = (p: Person) => [p.name || `Participant ${p.participant_id}`, p.applicant_type].filter(Boolean).join(' · ')

export default function App() {
  // the application (found by its number) and the participant whose ITR is verified
  const [applicationNumber, setApplicationNumber] = useState('')
  const [participants, setParticipants] = useState<Person[]>([])
  const [participantId, setParticipantId] = useState<number | ''>('')
  const [lookup, setLookup] = useState<{ state: 'idle' | 'loading' | 'found' | 'error'; message: string }>({ state: 'idle', message: '' })
  const [samples, setSamples] = useState<{ input: string[]; output: string[] }>({ input: [], output: [] })
  const [inputId, setInputId] = useState('')
  const [outputId, setOutputId] = useState('')
  const [panNumber, setPanNumber] = useState('')
  const [assessmentYear, setAssessmentYear] = useState('')
  const [gtiIncome, setGtiIncome] = useState('')
  const [finalStatus, setFinalStatus] = useState('')
  const [loading, setLoading] = useState(false)
  useAgentLoader(loading, "run")
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<VerificationResponse | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [autoStarted, setAutoStarted] = useState(false)
  const [activeTab, setActiveTab] = useState<'verify' | 'rules'>('verify')

  // Auto-load from URL query params:
  // /?input_id=customer_itr.pdf&output_id=vendor_itr.pdf
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const inId = params.get('input_id') || params.get('input') || ''
    const outId = params.get('output_id') || params.get('output') || ''

    if (inId && outId) {
      setInputId(inId)
      setOutputId(outId)
      const queryPan = params.get('pan_number') || ''
      const queryAssessmentYear = params.get('assessment_year') || ''
      const queryGtiIncome = params.get('gti_income') || ''
      const queryFinalStatus = params.get('final_status') || ''

      if (queryPan && queryAssessmentYear && queryGtiIncome !== '' && queryFinalStatus) {
        setPanNumber(queryPan)
        setAssessmentYear(queryAssessmentYear)
        setGtiIncome(queryGtiIncome)
        setFinalStatus(queryFinalStatus)
        setAutoStarted(true)
        runVerification(inId, outId, {
          panNumber: queryPan,
          assessmentYear: queryAssessmentYear,
          gtiIncome: queryGtiIncome,
          finalStatus: queryFinalStatus,
        })
      }
    }
  }, [])

  // Sample documents (testing): the files of the backend's local folders, one random pair filled in when the screen opens
  const pickSampleDocuments = (from = samples) => {
    if (from.input.length) setInputId(randomOf(from.input))
    if (from.output.length) setOutputId(randomOf(from.output))
  }
  useEffect(() => {
    let cancelled = false
    fetchSampleDocuments()
      .then((found) => {
        if (cancelled) return
        setSamples(found)
        const fromUrl = new URLSearchParams(window.location.search).has('input_id')   // an explicit link keeps its names
        if (PREFILL_SAMPLE_DOCUMENTS && !fromUrl) pickSampleDocuments(found)
      })
      .catch(() => { /* no sample documents: the names are typed as before */ })
    return () => { cancelled = true }
  }, [])

  // The application is looked up by its number a moment after typing stops; its people fill the Participant choice.
  useEffect(() => {
    const number = applicationNumber.trim()
    setParticipants([])
    setParticipantId('')
    if (!number) {
      setLookup({ state: 'idle', message: '' })
      return undefined
    }
    let cancelled = false
    setLookup({ state: 'loading', message: 'Looking up the application…' })
    const timer = setTimeout(async () => {
      try {
        const found = await fetchParticipants(number)
        if (cancelled) return
        setParticipants(found.participants)
        const first = found.participants.find((p) => p.is_primary) || found.participants[0]
        setParticipantId(first ? first.participant_id : '')
        setLookup(found.participants.length
          ? { state: 'found', message: '' }
          : { state: 'error', message: 'This application has no participants.' })
      } catch (e: any) {
        if (cancelled) return
        setLookup({ state: 'error', message: e?.message || 'Could not look up the application.' })
      }
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [applicationNumber])

  const runVerification = async (
    inId: string,
    outId: string,
    suppliedApplicationData?: { panNumber: string; assessmentYear: string; gtiIncome: string; finalStatus: string },
  ) => {
    if (!inId.trim() || !outId.trim()) {
      setError('Both Input and Output document names are required.')
      return
    }

    // a run started from the screen needs the application and the participant (a URL auto-start has its own values)
    if (!suppliedApplicationData && (!applicationNumber.trim() || participantId === '')) {
      setError('Enter the application number and choose the participant before verification.')
      return
    }

    const application = suppliedApplicationData || { panNumber, assessmentYear, gtiIncome, finalStatus }
    if (!application.panNumber.trim() || !application.assessmentYear.trim() || application.gtiIncome.trim() === '' || !application.finalStatus.trim()) {
      setError('Enter the customer PAN, assessment year, GTI income, and vendor final status before verification.')
      return
    }
    if (!Number.isFinite(Number(application.gtiIncome)) || Number(application.gtiIncome) < 0) {
      setError('GTI income must be a valid non-negative number.')
      return
    }

    setLoading(true)
    setError(null)
    setReport(null)

    try {
      const result = await verifyByIds(inId.trim(), outId.trim(), suppliedApplicationData ? application : {
        ...application, applicationNumber: applicationNumber.trim(), participantId: participantId === '' ? null : participantId })
      setReport(result)
    } catch (e: any) {
      setError(e?.message || 'Verification failed. Check API URL and that the files exist on the backend.')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    runVerification(inputId, outputId)
  }

  const handleReset = () => {
    setApplicationNumber('')
    setInputId('')
    setOutputId('')
    setPanNumber('')
    setAssessmentYear('')
    setGtiIncome('')
    setFinalStatus('')
    setReport(null)
    setError(null)
    setAutoStarted(false)
    window.history.replaceState({}, '', window.location.pathname)
  }

  const screen = useResultScreen(report)
  return (
    <AgentFrame agent="itr_verification" caseLabel={report ? [report.application_number, `${panNumber} · AY ${assessmentYear}`].filter(Boolean).join(' · ') : undefined}
      footer={import.meta.env.DEV ? (
        <button onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600">
          <Settings className="h-4 w-4" /> API Settings
        </button>
      ) : undefined}
      items={[
        { id: "verify", label: "Verify", icon: "file-check", active: activeTab === 'verify' && !screen.onResult,
          onSelect: () => { setActiveTab('verify'); screen.back() } },
        // "Rules Config" sidebar item hidden for now (owner request) -- uncomment to show it again.
        // { id: "rules", label: "Rules Config", icon: "list", active: activeTab === 'rules', onSelect: () => setActiveTab('rules') },
        ...(screen.hasResult ? [{ id: "result", label: "Result", icon: "sparkle", active: activeTab === 'verify' && screen.onResult,
          onSelect: () => { setActiveTab('verify'); screen.show() } }] : []),
      ]}>
    <div className="min-h-screen bg-slate-50">

      <main className="w-full px-4 py-6 sm:px-6 sm:py-8">
        {activeTab === 'rules' ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
            <RulesConfigTab />
          </section>
        ) : (
          <>
            {/* Document name form */}
            <FormArea hidden={screen.onResult}>
            <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
              <div className="mb-5 flex items-center gap-2">
                <FileCheck2 className="h-5 w-5 text-brand-600" />
                <h2 className="text-base font-semibold text-slate-800">
                  Document Names
                </h2>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* the case: which application, and which of its participants the ITR belongs to */}
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label htmlFor="itr-application-number" className="mb-1.5 block text-sm font-medium text-slate-700">
                      Application number
                    </label>
                    <input
                      id="itr-application-number"
                      required
                      type="text"
                      value={applicationNumber}
                      onChange={(e) => setApplicationNumber(e.target.value)}
                      placeholder="e.g. LOS-DUMMY-0045"
                      autoComplete="off"
                      aria-describedby="itr-application-lookup"
                      disabled={loading}
                      className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
                    />
                    <p id="itr-application-lookup" role="status"
                       className={`mt-1 min-h-[1rem] text-xs ${lookup.state === 'error' ? 'text-red-600' : 'text-slate-400'}`}>
                      {lookup.message}
                    </p>
                  </div>

                  <div>
                    <label htmlFor="itr-participant" className="mb-1.5 block text-sm font-medium text-slate-700">
                      Participant
                    </label>
                    <select
                      id="itr-participant"
                      required
                      value={participantId}
                      onChange={(e) => setParticipantId(e.target.value === '' ? '' : Number(e.target.value))}
                      disabled={loading || participants.length === 0}
                      className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm disabled:bg-slate-50"
                    >
                      {participants.length === 0 && <option value="">Enter an application number first</option>}
                      {participants.map((p) => (
                        <option key={p.participant_id} value={p.participant_id}>{personLabel(p)}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-slate-400">The person whose ITR is being verified</p>
                  </div>
                </div>

                {samples.input.length > 0 && samples.output.length > 0 && (
                  <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                    <button
                      type="button"
                      onClick={() => pickSampleDocuments()}
                      disabled={loading}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Shuffle className="h-4 w-4" />
                      Random sample documents
                    </button>
                    <span className="text-xs text-slate-400">For testing: picks a customer and a vendor ITR from the sample folders</span>
                  </div>
                )}
                <div className="grid gap-4 pt-1 md:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      Input Document (Customer)
                    </label>
                    <input
                      type="text"
                      value={inputId}
                      onChange={(e) => setInputId(e.target.value)}
                      placeholder="e.g. customer_itr.pdf"
                      disabled={loading}
                      className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      Document id in the input (customer) document store
                    </p>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      Output Document (Vendor)
                    </label>
                    <input
                      type="text"
                      value={outputId}
                      onChange={(e) => setOutputId(e.target.value)}
                      placeholder="e.g. vendor_itr.pdf"
                      disabled={loading}
                      className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      Document id in the output (vendor) document store
                    </p>
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <h3 className="mb-3 text-sm font-semibold text-slate-800">Customer Application Data / Vendor Decision</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Customer PAN</label>
                      <input
                        required
                        value={panNumber}
                        onChange={(e) => setPanNumber(e.target.value)}
                        placeholder="ABCDE1234F"
                        disabled={loading}
                        className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm uppercase"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Assessment Year</label>
                      <input
                        required
                        value={assessmentYear}
                        onChange={(e) => setAssessmentYear(e.target.value)}
                        placeholder="2024-25"
                        disabled={loading}
                        className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">GTI Income (₹)</label>
                      <input
                        required
                        type="number"
                        min="0"
                        step="any"
                        value={gtiIncome}
                        onChange={(e) => setGtiIncome(e.target.value)}
                        placeholder="e.g. 850000"
                        disabled={loading}
                        className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Vendor final_status</label>
                      <select
                        required
                        value={finalStatus}
                        onChange={(e) => setFinalStatus(e.target.value)}
                        disabled={loading}
                        className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
                      >
                        <option value="">Select vendor status</option>
                        <option value="Approved">Approved</option>
                        <option value="Rejected">Rejected</option>
                      </select>
                      <p className="mt-1 text-xs text-slate-400">Simulation of the vendor-selected API field.</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={loading || !inputId.trim() || !outputId.trim() || !applicationNumber.trim() || participantId === ''}
                    className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-on-ink transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Verifying…
                      </>
                    ) : (
                      <>
                        <Search className="h-4 w-4" />
                        Get Insights
                      </>
                    )}
                  </button>

                  {(inputId || outputId || report) && (
                    <button
                      type="button"
                      onClick={handleReset}
                      disabled={loading}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Reset
                    </button>
                  )}
                </div>
              </form>

              {error && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  <strong>Error:</strong> {error}
                  <p className="mt-1 text-xs text-red-600">
                    Ensure the backend is running and both documents exist in the configured document store.

                  </p>
                </div>
              )}

              {autoStarted && !error && !report && loading && (
                <p className="mt-3 text-sm text-slate-500">
                  Auto-started from URL parameters…
                </p>
              )}
            </section>
            </FormArea>

            {/* Results: the console's common result layout */}
            {report && screen.onResult && <BackToForm onBack={screen.back} note={`${panNumber} · AY ${assessmentYear}`} />}
            {report && screen.onResult && (
              <section className="-mx-4 sm:-mx-6" aria-label="Verification result">
                <ResultPage {...toResultPage(report, { application: { panNumber, assessmentYear }, onNewVerification: handleReset,
                  onDownload: () => downloadReport(report, { panNumber, assessmentYear }) })}>
                  {report.vendor_final_status === 'REJECTED' && (
                    <div role="alert" className="rounded-xl border-2 border-red-700 bg-red-600 p-4 text-white">
                      <div className="text-base font-extrabold uppercase tracking-wide">Critical: Vendor ITR Verification Rejected</div>
                      <div className="mt-1 text-sm">The vendor final_status overrides the score and the overall decision is REJECT.</div>
                    </div>
                  )}
                </ResultPage>
              </section>
            )}

            {/* Empty state */}
            {!report && !loading && !error && (
              <div className="mt-10 text-center text-sm text-slate-400">
                <p>
                  Enter the customer's and the vendor's ITR document names and click{' '}
                  <strong>Get Insights</strong>.
                </p>
              </div>
            )}
          </>
        )}
      </main>


      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
    </AgentFrame>
  )
}
