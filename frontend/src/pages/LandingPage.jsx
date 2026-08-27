import { motion } from "framer-motion";
import { ArrowRight, AudioLines, FileText, Image, Languages, Play, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

const features = [
    { icon: Languages, title: "Text to signing", copy: "Turn written language into clear, expressive sign language motion." },
    { icon: AudioLines, title: "Live speech", copy: "Capture spoken conversations and keep translation moving in real time." },
    { icon: FileText, title: "Documents", copy: "Bring PDFs, DOCX files, and notes into one accessible workflow." },
    { icon: Image, title: "Image understanding", copy: "Extract text from images and send it straight to your avatar." }
];

function LandingPage() {
    return (
        <div className="landing-page">
            <header className="landing-nav">
                <Link to="/" className="brand landing-brand">
                    <span className="brand-mark"><Sparkles size={17} /></span>
                    <span className="brand-copy"><strong>SignStream</strong><small>AI sign language</small></span>
                </Link>
                <nav className="landing-links">
                    <a href="#features">Features</a>
                    <a href="#workflow">How it works</a>
                    <a href="#about">About</a>
                </nav>
                <div className="landing-actions">
                    <Link className="button button-ghost" to="/login">Sign in</Link>
                    <Link className="button button-primary" to="/translate">Open studio <ArrowRight size={16} /></Link>
                </div>
            </header>

            <main>
                <section className="landing-hero">
                    <div className="hero-copy">
                        <motion.div className="hero-kicker" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
                            <span className="kicker-dot" /> The future of accessible communication
                        </motion.div>
                        <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
                            Give every word <em>a sign.</em>
                        </motion.h1>
                        <motion.p initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
                            SignStream turns text, speech, documents, and images into expressive sign language with a lifelike 3D avatar.
                        </motion.p>
                        <motion.div className="hero-actions" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}>
                            <Link className="button button-primary button-large" to="/translate">Start translating <ArrowRight size={17} /></Link>
                            <a className="button button-quiet button-large" href="#demo"><span className="play-icon"><Play size={13} fill="currentColor" /></span> Watch the demo</a>
                        </motion.div>
                        <div className="hero-trust"><span className="trust-avatars"><i>R</i><i>A</i><i>K</i><i>+</i></span><span>Built for people, teams, and classrooms</span></div>
                    </div>
                    <motion.div className="hero-visual" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.65 }}>
                        <div className="hero-glow" />
                        <div className="hero-grid" />
                        <div className="hero-avatar-card">
                            <div className="hero-avatar-top"><span className="status-pill status-ready"><span className="status-dot" /> Live preview</span><span className="hero-chip">VRM Studio</span></div>
                            <div className="hero-avatar-placeholder">
                                <img className="hero-human-image" src="/signstream-interpreter.png" alt="Sign language interpreter signing with both hands visible" />
                                <div className="hero-image-wash" />
                                <div className="motion-ring ring-one" />
                                <div className="motion-ring ring-two" />
                                <span className="hero-image-tag">Clear motion, human focus</span>
                            </div>
                            <div className="hero-avatar-bottom"><span><strong>Expressive motion</strong><small>Human-centered by design</small></span><span className="mini-wave">∿∿∿</span></div>
                        </div>
                    </motion.div>
                </section>

                <section className="logo-strip"><span>Designed for meaningful moments</span><div><strong>ACCESSIBILITY</strong><strong>EDUCATION</strong><strong>COMMUNITY</strong><strong>CREATORS</strong></div></section>
                <section className="section-block" id="features"><div className="section-heading"><span className="eyebrow">One calm workspace</span><h2>Translation that feels human.</h2><p>Everything you need to move from language to understanding without losing nuance.</p></div><div className="feature-grid">{features.map(({ icon: Icon, title, copy }, index) => <motion.article className="feature-card" key={title} whileHover={{ y: -5 }} transition={{ duration: 0.2 }}><span className={`feature-icon feature-icon-${index}`}><Icon size={20} /></span><h3>{title}</h3><p>{copy}</p><span className="card-arrow"><ArrowRight size={15} /></span></motion.article>)}</div></section>
                <section className="workflow-section" id="workflow"><div className="workflow-copy"><span className="eyebrow">A simpler workflow</span><h2>From input to expression in seconds.</h2><p>SignStream brings language processing and avatar motion into one focused studio, so the technology disappears and the message stays.</p><Link className="text-link" to="/dashboard">Explore the workspace <ArrowRight size={15} /></Link></div><div className="workflow-steps"><div className="workflow-step active"><span>01</span><div><strong>Choose your input</strong><p>Text, voice, a document, or an image.</p></div></div><div className="workflow-step"><span>02</span><div><strong>Shape the meaning</strong><p>Review glosses and translation steps.</p></div></div><div className="workflow-step"><span>03</span><div><strong>Share the expression</strong><p>Play, save, or export your result.</p></div></div></div></section>
            </main>
            <footer className="landing-footer" id="about"><div className="brand"><span className="brand-mark"><Sparkles size={17} /></span><span className="brand-copy"><strong>SignStream</strong><small>AI sign language</small></span></div><span>Technology for more human connection.</span><span>© 2026 SignStream</span></footer>
        </div>
    );
}

export default LandingPage;
