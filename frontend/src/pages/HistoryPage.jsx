import { useEffect, useState } from "react";
import { Clock3, ExternalLink, Languages, Search, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { readHistory, removeHistoryEntry } from "../services/motionCatalog";

function HistoryPage({ savedOnly = false }) {
    const [entries, setEntries] = useState([]);
    const [query, setQuery] = useState("");

    useEffect(() => setEntries(readHistory()), []);

    const filtered = entries.filter((entry) => (!savedOnly || entry.saved) && `${entry.title} ${entry.gloss}`.toLowerCase().includes(query.toLowerCase()));

    const remove = (id) => setEntries(removeHistoryEntry(id));

    return <div className="page-stack"><section className="page-intro"><div><span className="eyebrow">{savedOnly ? "Your collection" : "Workspace activity"}</span><h1>{savedOnly ? "Saved translations" : "Translation history"}</h1><p>{savedOnly ? "Keep your most useful expressions close at hand." : "A private record of the messages you have brought to life."}</p></div><Link className="button button-primary" to="/translate"><Languages size={16} /> New translation</Link></section><section className="panel-card table-card"><div className="table-toolbar"><label className="search-field"><Search size={16} /><span className="visually-hidden">Search translations</span><input aria-label="Search translations" placeholder="Search translations" value={query} onChange={(event) => setQuery(event.target.value)} /></label><span className="table-count">{filtered.length} {filtered.length === 1 ? "entry" : "entries"}</span></div>{filtered.length === 0 ? <div className="empty-state large-empty"><span className="empty-icon"><Clock3 size={21} /></span><strong>{query ? "No matching translations" : "Nothing here yet"}</strong><span>Start a translation and it will appear in this list.</span><Link className="text-link" to="/translate">Open the studio →</Link></div> : <div className="history-table">{filtered.map((entry) => <div className="history-row" key={entry.id}><span className="history-type"><Languages size={16} /></span><span className="history-title"><strong>{entry.title}</strong><small>{entry.gloss || "Motion preview"}</small></span><span className="history-time">{entry.time}</span><button type="button" className="icon-button" onClick={() => remove(entry.id)} aria-label="Delete translation"><Trash2 size={15} /></button><Link className="icon-button" to={`/translate?text=${encodeURIComponent(entry.text || entry.title || "")}`} aria-label="Open translation"><ExternalLink size={15} /></Link></div>)}</div>}</section></div>;
}

export default HistoryPage;
