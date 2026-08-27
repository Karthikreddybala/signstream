import { useEffect, useState } from "react";
import { Bell, Check, LockKeyhole, Moon, Palette, UserRound } from "lucide-react";

function SettingsPage({ profile = false }) {
    const [theme, setTheme] = useState(() => localStorage.getItem("signstream-theme") ?? "dark");
    const [speed, setSpeed] = useState(() => localStorage.getItem("signstream-speed") ?? "1");
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        localStorage.setItem("signstream-theme", theme);
    }, [theme]);

    const save = () => {
        localStorage.setItem("signstream-speed", speed);
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1800);
    };

    return <div className="page-stack settings-page"><section className="page-intro"><div><span className="eyebrow">{profile ? "Your account" : "Workspace preferences"}</span><h1>{profile ? "Profile" : "Settings"}</h1><p>{profile ? "Manage your SignStream identity and workspace details." : "Tune your workspace to feel like your own."}</p></div></section><div className="settings-layout"><nav className="settings-nav"><button className="settings-nav-item active"><UserRound size={17} /> {profile ? "Profile details" : "General"}</button><button className="settings-nav-item"><Palette size={17} /> Appearance</button><button className="settings-nav-item"><Bell size={17} /> Notifications</button><button className="settings-nav-item"><LockKeyhole size={17} /> Security</button></nav><section className="panel-card settings-card"><div className="settings-section"><div className="settings-heading"><span className="settings-heading-icon"><UserRound size={18} /></span><div><h2>{profile ? "Profile details" : "General preferences"}</h2><p>{profile ? "This is how your identity appears in the workspace." : "Configure your default SignStream experience."}</p></div></div><div className="settings-form"><label className="field-label">Full name<input className="text-input" defaultValue="Saket Agarwal" /></label><label className="field-label">Email address<input className="text-input" defaultValue="saket@example.com" type="email" /></label><label className="field-label">Default playback speed<div className="setting-range"><input type="range" min="0.1" max="3" step="0.05" value={speed} onChange={(event) => setSpeed(event.target.value)} /><strong>{Number(speed).toFixed(2)}x</strong></div></label></div></div><div className="settings-section"><div className="settings-heading"><span className="settings-heading-icon"><Moon size={18} /></span><div><h2>Appearance</h2><p>Choose a theme that works for your day.</p></div></div><div className="theme-picker"><button className={`theme-option ${theme === "light" ? "selected" : ""}`} onClick={() => setTheme("light")}><span className="theme-preview theme-preview-light" /><strong>Light</strong>{theme === "light" && <Check size={15} />}</button><button className={`theme-option ${theme === "dark" ? "selected" : ""}`} onClick={() => setTheme("dark")}><span className="theme-preview theme-preview-dark" /><strong>Dark</strong>{theme === "dark" && <Check size={15} />}</button></div></div><div className="settings-actions"><span>{saved ? <><Check size={15} /> Saved</> : "Changes are saved locally for this workspace."}</span><button className="button button-primary" onClick={save}>Save changes</button></div></section></div></div>;
}

export default SettingsPage;
