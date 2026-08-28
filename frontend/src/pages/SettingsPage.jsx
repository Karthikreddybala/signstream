import { useEffect, useState } from "react";
import { Check, Moon, Palette, UserRound } from "lucide-react";

function getPreference(key, fallback) {
    try {
        return localStorage.getItem(key) ?? fallback;
    } catch {
        return fallback;
    }
}

function SettingsPage({ profile = false }) {
    const [theme, setTheme] = useState(() => getPreference("signstream-theme", "dark"));
    const [speed, setSpeed] = useState(() => getPreference("signstream-speed", "1"));
    const [name, setName] = useState(() => getPreference("signstream-name", "Saket Agarwal"));
    const [email, setEmail] = useState(() => getPreference("signstream-email", "saket@example.com"));
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        try {
            localStorage.setItem("signstream-theme", theme);
        } catch {
            // The theme still applies in memory when storage is unavailable.
        }
    }, [theme]);

    const save = () => {
        try {
            localStorage.setItem("signstream-speed", speed);
            localStorage.setItem("signstream-name", name);
            localStorage.setItem("signstream-email", email);
        } catch {
            // Keep the current values in memory when storage is unavailable.
        }
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1800);
    };

    return (
        <div className="page-stack settings-page">
            <section className="page-intro">
                <div>
                    <span className="eyebrow">{profile ? "Your account" : "Workspace preferences"}</span>
                    <h1>{profile ? "Profile" : "Settings"}</h1>
                    <p>{profile ? "Manage your SignStream identity and workspace details." : "Tune your workspace to feel like your own."}</p>
                </div>
            </section>

            <div className="settings-layout">
                <nav className="settings-nav" aria-label="Settings sections">
                    <a className="settings-nav-item active" href="#profile-settings"><UserRound size={17} /> {profile ? "Profile details" : "General"}</a>
                    <a className="settings-nav-item" href="#appearance-settings"><Palette size={17} /> Appearance</a>
                </nav>

                <section className="panel-card settings-card">
                    <div className="settings-section" id="profile-settings">
                        <div className="settings-heading">
                            <span className="settings-heading-icon"><UserRound size={18} /></span>
                            <div>
                                <h2>{profile ? "Profile details" : "General preferences"}</h2>
                                <p>{profile ? "This is how your identity appears in the workspace." : "Configure your default SignStream experience."}</p>
                            </div>
                        </div>
                        <div className="settings-form">
                            <label className="field-label" htmlFor="profile-name">Full name<input id="profile-name" className="text-input" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>
                            <label className="field-label" htmlFor="profile-email">Email address<input id="profile-email" className="text-input" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" type="email" /></label>
                            <label className="field-label" htmlFor="playback-speed">Default playback speed<div className="setting-range"><input id="playback-speed" type="range" min="0.1" max="3" step="0.05" value={speed} onChange={(event) => setSpeed(event.target.value)} /><strong>{Number(speed).toFixed(2)}x</strong></div></label>
                        </div>
                    </div>

                    <div className="settings-section" id="appearance-settings">
                        <div className="settings-heading">
                            <span className="settings-heading-icon"><Moon size={18} /></span>
                            <div><h2>Appearance</h2><p>Choose a theme that works for your day.</p></div>
                        </div>
                        <div className="theme-picker" role="radiogroup" aria-label="Theme">
                            <button type="button" className={`theme-option ${theme === "light" ? "selected" : ""}`} onClick={() => setTheme("light")} role="radio" aria-checked={theme === "light"}><span className="theme-preview theme-preview-light" /><strong>Light</strong>{theme === "light" && <Check size={15} />}</button>
                            <button type="button" className={`theme-option ${theme === "dark" ? "selected" : ""}`} onClick={() => setTheme("dark")} role="radio" aria-checked={theme === "dark"}><span className="theme-preview theme-preview-dark" /><strong>Dark</strong>{theme === "dark" && <Check size={15} />}</button>
                        </div>
                    </div>

                    <div className="settings-actions">
                        <span aria-live="polite">{saved ? <><Check size={15} /> Saved</> : "Changes are saved locally for this workspace."}</span>
                        <button type="button" className="button button-primary" onClick={save}>Save changes</button>
                    </div>
                </section>
            </div>
        </div>
    );
}

export default SettingsPage;
