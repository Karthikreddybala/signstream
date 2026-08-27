import { useState } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Sparkles } from "lucide-react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { login, register } from "../services/apiClient";

function AuthPage({ registerMode = false }) {
    const navigate = useNavigate();
    const location = useLocation();
    const [showPassword, setShowPassword] = useState(false);
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const submit = async (event) => {
        event.preventDefault();
        setError("");
        setLoading(true);
        try {
            if (registerMode) {
                await register({ name, email, password });
            } else {
                await login({ email, password });
            }
            navigate(location.state?.from ?? "/dashboard", { replace: true });
        } catch (requestError) {
            setError(getRequestErrorMessage(requestError));
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="auth-page">
            <Link className="auth-back" to="/"><ArrowLeft size={15} /> Back to home</Link>
            <div className="auth-layout">
                <section className="auth-card">
                    <Link className="brand auth-brand" to="/"><span className="brand-mark"><Sparkles size={17} /></span><span className="brand-copy"><strong>SignStream</strong><small>AI sign language</small></span></Link>
                    <div className="auth-heading"><span className="eyebrow">{registerMode ? "Create your workspace" : "Welcome back"}</span><h1>{registerMode ? "Start expressing more." : "Continue your work."}</h1><p>{registerMode ? "Create a SignStream workspace and bring your first message to life." : "Sign in to return to your translation studio."}</p></div>
                    <form className="auth-form" onSubmit={submit}>
                        {registerMode && <label className="field-label">Full name<input className="text-input" value={name} onChange={(event) => setName(event.target.value)} required /></label>}
                        <label className="field-label">Email address<input className="text-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
                        <label className="field-label">Password<div className="password-field"><input className="text-input" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label="Toggle password visibility">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
                        {error && <p className="form-error">{error}</p>}
                        <button className="button button-primary button-large full-button" disabled={loading}>{loading ? "Connecting…" : registerMode ? "Create workspace" : "Sign in"} <ArrowRight size={16} /></button>
                    </form>
                    <p className="auth-switch">{registerMode ? "Already have an account?" : "New to SignStream?"} <Link to={registerMode ? "/login" : "/register"}>{registerMode ? "Sign in" : "Create an account"}</Link></p>
                </section>
                <aside className="auth-visual">
                    <img src="/signstream-interpreter.png" alt="Sign language interpreter signing in a calm studio" />
                    <div className="auth-visual-overlay" />
                    <div className="auth-visual-copy"><span className="status-pill status-ready"><span className="status-dot" /> Human-centered translation</span><h2>Make every conversation easier to follow.</h2><p>Move from words to clear expression in one calm, focused workspace.</p></div>
                </aside>
            </div>
            <span className="auth-note">Your local motion studio works without an account.</span>
        </main>
    );
}

function getRequestErrorMessage(error) {
    const detail = error.response?.data?.detail;

    if (Array.isArray(detail)) {
        return detail
            .map((item) => {
                const field = Array.isArray(item.loc) ? item.loc.at(-1) : "field";
                return `${String(field)}: ${item.msg}`;
            })
            .join(" ");
    }

    if (typeof detail === "string" && detail.trim()) {
        return detail;
    }

    return "The API is not available yet. You can still explore the local studio.";
}

export default AuthPage;
