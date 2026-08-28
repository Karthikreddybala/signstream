import { useEffect, useState } from "react";
import { ArrowRight, Clock3, FileText, Languages, Mic2, Plus, Sparkles, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { loadMotionCatalog, readHistory } from "../services/motionCatalog";

function DashboardPage() {
    const [catalog, setCatalog] = useState(null);
    const [history, setHistory] = useState([]);
    const today = new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric"
    }).format(new Date());

    useEffect(() => {
        setHistory(readHistory());
        loadMotionCatalog().then(setCatalog).catch(() => setCatalog({ clips: [] }));
    }, []);

    const clipCount = catalog?.clips?.length ?? 0;
    const readyCount = catalog?.clips?.filter((clip) => clip.status !== "pending").length ?? 0;

    return (
        <div className="page-stack">
            <section className="page-intro dashboard-intro"><div><span className="eyebrow">{today}</span><h1>Good morning, Saket <span className="wave">✦</span></h1><p>Your workspace is ready when you are. What would you like to express?</p></div><Link className="button button-primary" to="/translate"><Plus size={17} /> New translation</Link></section>
            <section className="stat-grid"><StatCard icon={Languages} label="Translations this week" value={history.length} trend="Your workspace activity" /><StatCard icon={TrendingUp} label="Motion library" value={catalog ? clipCount : "—"} trend={`${readyCount} ready motion clips`} accent="violet" /><StatCard icon={Clock3} label="Average session" value="4m 12s" trend="Keep exploring" accent="blue" /></section>
            <section className="dashboard-grid"><div className="panel-card quick-panel"><div className="panel-heading"><div><span className="eyebrow">Create</span><h2>Start with an input</h2></div><Sparkles size={18} className="muted-icon" /></div><div className="quick-actions"><QuickAction to="/translate" icon={Languages} title="Text translation" copy="Write or paste a message" /><QuickAction to="/speech" icon={Mic2} title="Live speech" copy="Translate from your microphone" /><QuickAction to="/documents" icon={FileText} title="Upload a document" copy="PDF, DOCX, or TXT" /></div></div><div className="panel-card recent-panel"><div className="panel-heading"><div><span className="eyebrow">Your workspace</span><h2>Recent translations</h2></div><Link className="text-link" to="/history">View all <ArrowRight size={14} /></Link></div>{history.length === 0 ? <EmptyState /> : <div className="recent-list">{history.slice(0, 4).map((entry) => <div className="recent-row" key={entry.id}><span className="recent-icon"><Languages size={16} /></span><span><strong>{entry.title}</strong><small>{entry.gloss ?? "Text translation"}</small></span><time>{entry.time}</time></div>)}</div>}</div></section>
            <section className="banner-card"><div className="banner-orb"><Sparkles size={20} /></div><div><span className="eyebrow">Designed for clarity</span><h2>Every message deserves to be understood.</h2><p>Use the studio to review glosses, tune playback, and build a translation that feels natural.</p></div><Link className="button button-light" to="/translate">Open studio <ArrowRight size={16} /></Link></section>
        </div>
    );
}

function StatCard({ icon: Icon, label, value, trend, accent = "orange" }) { return <article className="stat-card"><span className={`stat-icon stat-icon-${accent}`}><Icon size={18} /></span><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><span className="stat-trend"><TrendingUp size={13} /> {trend}</span></article>; }
function QuickAction({ to, icon: Icon, title, copy }) { return <Link className="quick-action" to={to}><span className="quick-icon"><Icon size={19} /></span><span><strong>{title}</strong><small>{copy}</small></span><ArrowRight size={16} /></Link>; }
function EmptyState() { return <div className="empty-state"><span className="empty-icon"><Clock3 size={20} /></span><strong>Your translations will appear here</strong><span>Start a new translation to build your history.</span></div>; }

export default DashboardPage;
