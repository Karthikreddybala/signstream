import { useCallback, useMemo, useState } from "react";
import { ArrowRight, Check, Clipboard, Languages, List, Save, Sparkles, WandSparkles } from "lucide-react";
import AvatarViewport from "../components/avatar/AvatarViewport";
import { translateText } from "../services/apiClient";
import { writeHistory } from "../services/motionCatalog";
import { useSearchParams } from "react-router-dom";

function TranslatePage() {
    const [searchParams] = useSearchParams();
    const [text, setText] = useState(() => searchParams.get("text") ?? "");
    const [glosses, setGlosses] = useState([]);
    const [selectedGloss, setSelectedGloss] = useState("");
    const [detected, setDetected] = useState([]);
    const [translated, setTranslated] = useState(false);
    const [saved, setSaved] = useState(false);
    const [translating, setTranslating] = useState(false);
    const [exportVideo, setExportVideo] = useState(null);
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState("");
    const [unknownGlosses, setUnknownGlosses] = useState([]);
    const [provider, setProvider] = useState("preview");

    const handleReady = useCallback(({ glosses: available, exportVideo: exportHandler }) => {
        setGlosses(available);
        setSelectedGloss((current) => current || available[0] || "");
        setExportVideo(() => exportHandler);
    }, []);

    const handleSequenceChange = useCallback(({ gloss }) => {
        setSelectedGloss(gloss ?? "");
    }, []);

    const matchingGlosses = useMemo(() => {
        return orderGlossesBySentence(text, glosses).slice(0, 20);
    }, [glosses, text]);

    const translate = async () => {
        setTranslating(true);
        let result = matchingGlosses;
        try {
            const response = await translateText(text);
            result = response.glosses;
            setUnknownGlosses(response.unknown_glosses);
            setProvider(response.provider);
        } catch {
            result = matchingGlosses;
            setUnknownGlosses([]);
            setProvider("local preview");
        }
        setDetected(result);
        setSelectedGloss(result[0] ?? "");
        setTranslated(true);
        setSaved(false);
        setTranslating(false);
    };

    const handleTextChange = (event) => {
        setText(event.target.value);
        setTranslated(false);
        setUnknownGlosses([]);
        setProvider("preview");
        setSaved(false);
    };

    const visibleGlosses = translated ? detected : matchingGlosses;

    const saveTranslation = () => {
        writeHistory({ id: crypto.randomUUID(), title: text.trim() || "Motion library preview", gloss: selectedGloss, time: "Just now", saved: true });
        setSaved(true);
    };

    const downloadVideo = async () => {
        if (!exportVideo || detected.length === 0) return;
        setExporting(true);
        setExportError("");

        try {
            const blob = await exportVideo(detected);
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "signstream-translation.webm";
            anchor.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            setExportError(error?.message || "Video export failed.");
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="page-stack translate-page">
            <section className="page-intro"><div><span className="eyebrow">Translation studio</span><h1>Turn language into expression.</h1><p>Shape your message, review the glosses, and let your avatar do the signing.</p></div><span className="workspace-status"><span className="status-dot status-dot-green" /> Motion engine online</span></section>
            <section className="gloss-sequence-card panel-card" aria-live="polite">
                <div className="panel-heading"><div><span className="eyebrow">{translated ? "Generated glosses" : "Gloss preview"}</span><h2>{translated ? "Signing sequence" : "Words found in your message"}</h2></div><span className="status-pill status-muted">{translated ? provider : "Updates as you type"}</span></div>
                {visibleGlosses.length > 0 ? <div className="gloss-token-list">{visibleGlosses.map((gloss, index) => <span className="gloss-token" key={`${gloss}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span>{gloss}</span>)}</div> : <p className="gloss-sequence-empty">Type a sentence to preview the available gloss words.</p>}
                {unknownGlosses.length > 0 && <small className="gloss-unknown">No motion clip found for: {unknownGlosses.join(", ")}</small>}
            </section>
            <div className="translation-layout">
                <aside className="translation-input panel-card"><div className="panel-heading"><div><span className="eyebrow">Step 01</span><h2>Your message</h2></div><span className="panel-step">1/3</span></div><label className="field-label" htmlFor="translation-input">Text to translate</label><textarea id="translation-input" value={text} onChange={handleTextChange} placeholder="Write something you want to express…" maxLength={1000} /><div className="field-meta"><span>{text.length}/1000 characters</span><button className="small-action" onClick={() => navigator.clipboard?.readText().then(setText)}><Clipboard size={13} /> Paste</button></div><div className="language-row"><span><span className="language-flag">EN</span> English</span><ArrowRight size={14} /><span><span className="language-flag language-flag-orange">ISL</span> Sign language</span></div><button className="button button-primary full-button" onClick={translate} disabled={!text.trim() || translating}><WandSparkles size={16} /> {translating ? "Translating…" : "Translate message"} <ArrowRight size={16} /></button><div className="suggestion-box"><Sparkles size={15} /><span><strong>Try a clear sentence</strong><small>“The meeting starts at nine.”</small></span></div></aside>
            <div className="translation-center"><AvatarViewport selectedGloss={selectedGloss} sequenceGlosses={detected} sequenceLoop onReady={handleReady} onSequenceChange={handleSequenceChange} /></div>
            <aside className="translation-inspector panel-card"><div className="panel-heading"><div><span className="eyebrow">Step 02</span><h2>Translation flow</h2></div><span className="panel-step">2/3</span></div>{!translated ? <div className="inspector-empty"><span className="empty-icon"><List size={20} /></span><strong>Glosses appear here</strong><span>Translate a message to inspect the motion sequence.</span></div> : <><div className="flow-status"><span className="status-dot status-dot-green" /><span><strong>Translation ready</strong><small>{detected.length} motion {detected.length === 1 ? "clip" : "clips"} detected</small></span><Check size={17} /></div><div className="gloss-list">{detected.map((gloss, index) => <button className={`gloss-row ${selectedGloss === gloss ? "active" : ""}`} key={`${gloss}-${index}`} onClick={() => setSelectedGloss(gloss)}><span className="gloss-number">{String(index + 1).padStart(2, "0")}</span><span><strong>{gloss}</strong><small>Motion clip ready</small></span><span className="gloss-check"><Check size={13} /></span></button>)}</div><div className="inspector-actions"><button className="button button-secondary full-button" onClick={saveTranslation}><Save size={15} /> {saved ? "Saved to history" : "Save translation"}</button><button className="button button-ghost full-button" onClick={downloadVideo} disabled={exporting || !exportVideo}>{exporting ? "Rendering video…" : "↓ Download video"}</button>{exportError && <small className="workflow-message">{exportError}</small>}</div></>}</aside>
            </div>
            <section className="translation-footer-note"><Languages size={17} /><span><strong>ISL motion library</strong> is powered by your locally generated VRM motion clips.</span><span className="note-divider" /><span>Playback is processed in your browser.</span></section>
        </div>
    );
}

function orderGlossesBySentence(text, availableGlosses) {
    const words = text.toLowerCase().match(/[a-z]+(?:['-][a-z]+)*/g) ?? [];
    const candidates = availableGlosses
        .map((gloss) => ({
            gloss,
            words: gloss.toLowerCase().match(/[a-z]+(?:['-][a-z]+)*/g) ?? []
        }))
        .filter((candidate) => candidate.words.length > 0)
        .sort((left, right) => right.words.length - left.words.length);
    const ordered = [];

    for (let index = 0; index < words.length;) {
        const match = candidates.find((candidate) => candidate.words.every(
            (word, offset) => words[index + offset] === word
        ));

        if (!match) {
            index += 1;
            continue;
        }

        ordered.push(match.gloss);
        index += match.words.length;
    }

    return ordered;
}

export default TranslatePage;
