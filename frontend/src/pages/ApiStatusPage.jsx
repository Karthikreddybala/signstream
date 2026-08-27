import { useCallback, useEffect, useState } from "react";
import {
    Activity,
    CheckCircle2,
    Database,
    RefreshCw,
    Server,
    Sparkles,
    WifiOff
} from "lucide-react";
import { getApiStatus, testLlmConnection } from "../services/apiClient";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api";

function ApiStatusPage() {
    const [status, setStatus] = useState(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [llmTesting, setLlmTesting] = useState(false);

    const checkStatus = useCallback(async (manual = false) => {
        if (manual) {
            setRefreshing(true);
        }

        try {
            const response = await getApiStatus();
            setStatus(response);
            setError("");
        } catch {
            setError("The API could not be reached. Check that the backend is running.");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    const runLlmCheck = async () => {
        setLlmTesting(true);

        try {
            const response = await testLlmConnection();
            setStatus(response);
            setError("");
        } catch {
            setError("The LLM check endpoint could not be reached.");
        } finally {
            setLlmTesting(false);
        }
    };

    useEffect(() => {
        checkStatus();
        const interval = window.setInterval(() => checkStatus(), 30000);
        return () => window.clearInterval(interval);
    }, [checkStatus]);

    const operational = status?.status === "ok" && !error;
    const library = status?.motion_library;
    const llm = status?.llm;

    return (
        <div className="page-stack status-page">
            <section className="page-intro">
                <div>
                    <span className="eyebrow">System monitor</span>
                    <h1>API status</h1>
                    <p>Monitor the translation service, gloss provider, and motion library from one place.</p>
                </div>
                <button className="button button-secondary" onClick={() => checkStatus(true)} disabled={refreshing}>
                    <RefreshCw size={15} className={refreshing ? "spin" : ""} />
                    {refreshing ? "Checking…" : "Refresh status"}
                </button>
            </section>

            <section className={`status-hero panel-card ${operational ? "status-hero-ready" : "status-hero-error"}`}>
                <span className="status-hero-icon">{operational ? <CheckCircle2 size={23} /> : <WifiOff size={23} />}</span>
                <div>
                    <span className="eyebrow">Connection</span>
                    <h2>{loading ? "Checking the API…" : operational ? "All systems operational" : "API unavailable"}</h2>
                    <p>{error || `${status?.service ?? "SignStream API"} is responding normally.`}</p>
                </div>
                <span className={`status-pill ${operational ? "status-ready" : "status-muted"}`}>
                    <span className="status-dot" /> {operational ? "Online" : "Offline"}
                </span>
            </section>

            <section className="status-grid">
                <StatusCard icon={Server} label="API service" value={status?.service ?? "—"} detail={status?.environment ?? "Waiting for response"} ready={operational} />
                <StatusCard icon={Sparkles} label="Gloss provider" value={status?.llm_provider ?? "—"} detail="Configured server-side" ready={operational} />
                <StatusCard icon={Database} label="Motion library" value={library ? `${library.ready} ready` : "—"} detail={library ? `${library.clips} total · ${library.pending} pending` : "Waiting for response"} ready={operational} />
            </section>

            <section className="panel-card llm-diagnostics">
                <div className="panel-heading">
                    <div><span className="eyebrow">LLM diagnostics</span><h2>Provider response and token usage</h2></div>
                    <button className="button button-secondary" onClick={runLlmCheck} disabled={llmTesting || !operational}>
                        <Sparkles size={14} /> {llmTesting ? "Testing…" : "Test LLM response"}
                    </button>
                </div>
                <div className="llm-detail-grid">
                    <LlmDetail label="Response" value={formatResponding(llm?.responding)} state={llm?.responding} />
                    <LlmDetail label="Provider" value={llm?.provider ?? "—"} />
                    <LlmDetail label="Model" value={llm?.model ?? "—"} />
                    <LlmDetail label="API key" value={llm?.api_key_configured ? "Configured (hidden)" : "Missing"} state={llm?.api_key_configured ? "yes" : "no"} />
                    <LlmDetail label="Mode" value={llm?.mode ?? "—"} />
                    <LlmDetail label="Last latency" value={llm?.last_latency_ms === null || llm?.last_latency_ms === undefined ? "Not tested" : `${llm.last_latency_ms} ms`} />
                    <LlmDetail label="Requests" value={llm ? `${llm.successful_requests} successful · ${llm.failed_requests} failed` : "—"} />
                </div>
                <div className="llm-token-grid">
                    <TokenMetric label="Tokens left" value={formatTokens(llm?.tokens.remaining)} detail={llm?.tokens.local_budget ? "Local budget remaining" : "Provider quota unavailable"} />
                    <TokenMetric label="Last request" value={formatTokens(llm?.tokens.last_total)} detail="Prompt + completion tokens" />
                    <TokenMetric label="Session usage" value={formatTokens(llm?.tokens.session_total)} detail={`${formatTokens(llm?.tokens.session_prompt)} prompt · ${formatTokens(llm?.tokens.session_completion)} output`} />
                </div>
                <p className="llm-note">{llm?.tokens.quota_note ?? "Token quota information is unavailable."} Usage counters are process-local and reset when the API restarts.</p>
                {llm?.last_error && <p className="llm-error">Last error: {llm.last_error.code} — {llm.last_error.message}</p>}
            </section>

            <section className="panel-card status-details">
                <div className="panel-heading">
                    <div><span className="eyebrow">Diagnostics</span><h2>Service details</h2></div>
                    <Activity size={18} className="muted-icon" />
                </div>
                <div className="status-detail-list">
                    <StatusDetail label="API endpoint" value={apiUrl} />
                    <StatusDetail label="Last checked" value={status ? formatDate(status.checked_at) : "Not checked yet"} />
                    <StatusDetail label="Automatic refresh" value="Every 30 seconds" />
                    <StatusDetail label="Motion availability" value={library ? `${library.ready} of ${library.clips} clips ready` : "Unknown"} />
                </div>
            </section>
        </div>
    );
}

function StatusCard({ icon: Icon, label, value, detail, ready }) {
    return (
        <article className="panel-card status-card">
            <span className={`status-card-icon ${ready ? "status-card-icon-ready" : ""}`}><Icon size={19} /></span>
            <span className="status-label">{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
        </article>
    );
}

function StatusDetail({ label, value }) {
    return <div className="status-detail-row"><span>{label}</span><strong>{value}</strong></div>;
}

function LlmDetail({ label, value, state }) {
    return <div className="llm-detail"><span>{label}</span><strong className={state ? `llm-state-${state}` : ""}>{value}</strong></div>;
}

function TokenMetric({ label, value, detail }) {
    return <div className="token-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function formatResponding(value) {
    return {
        yes: "Responding",
        no: "Last request failed",
        not_configured: "API key missing",
        unknown: "Not tested"
    }[value] ?? "Not checked";
}

function formatTokens(value) {
    return value === null || value === undefined ? "Not available" : value.toLocaleString();
}

function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

export default ApiStatusPage;
