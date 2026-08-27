import { ArrowLeft, SearchX } from "lucide-react";
import { Link } from "react-router-dom";

function NotFoundPage() {
    return <main className="not-found"><span className="not-found-icon"><SearchX size={30} /></span><span className="eyebrow">404 error</span><h1>This page got lost.</h1><p>The page you are looking for does not exist or has moved.</p><Link className="button button-primary" to="/dashboard"><ArrowLeft size={16} /> Return to workspace</Link></main>;
}

export default NotFoundPage;
