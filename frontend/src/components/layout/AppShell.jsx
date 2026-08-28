import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
    Activity,
    Bookmark,
    ChevronRight,
    CircleHelp,
    Clock3,
    FileText,
    Home,
    Image,
    Languages,
    Menu,
    Mic2,
    Moon,
    PanelLeftClose,
    PanelLeftOpen,
    Settings,
    Sparkles,
    Sun,
    UserRound
} from "lucide-react";

const primaryNavigation = [
    { label: "Overview", path: "/dashboard", icon: Home },
    { label: "Translate", path: "/translate", icon: Languages },
    { label: "Live speech", path: "/speech", icon: Mic2 },
    { label: "Documents", path: "/documents", icon: FileText },
    { label: "Images", path: "/images", icon: Image }
];

const libraryNavigation = [
    { label: "History", path: "/history", icon: Clock3 },
    { label: "Saved translations", path: "/saved", icon: Bookmark },
    { label: "API status", path: "/status", icon: Activity }
];

function AppShell() {
    const location = useLocation();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(
        () => localStorage.getItem("signstream-sidebar-collapsed") === "true"
    );
    const [theme, setTheme] = useState(
        () => localStorage.getItem("signstream-theme") ?? "dark"
    );

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        localStorage.setItem("signstream-theme", theme);
    }, [theme]);

    useEffect(() => {
        localStorage.setItem("signstream-sidebar-collapsed", String(collapsed));
    }, [collapsed]);

    useEffect(() => {
        setMobileOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        document.title = `${getPageName(location.pathname)} · SignStream`;
    }, [location.pathname]);

    const toggleTheme = () => {
        setTheme((current) => current === "dark" ? "light" : "dark");
    };

    return (
        <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
            <a className="skip-link" href="#main-content">Skip to content</a>
            <button
                className="mobile-backdrop"
                aria-label="Close navigation"
                onClick={() => setMobileOpen(false)}
                data-open={mobileOpen}
            />
            <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
                <div className="sidebar-header">
                    <NavLink className="brand" to="/dashboard">
                        <span className="brand-mark"><Sparkles size={17} /></span>
                        <span className="brand-copy">
                            <strong>SignStream</strong>
                            <small>AI sign language</small>
                        </span>
                    </NavLink>
                    <button
                        className="icon-button sidebar-collapse"
                        onClick={() => setCollapsed((value) => !value)}
                        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    >
                        {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
                    </button>
                </div>

                <div className="workspace-switcher">
                    <span className="workspace-avatar">S</span>
                    <span className="workspace-copy">
                        <strong>Personal workspace</strong>
                        <small>Free plan</small>
                    </span>
                    <ChevronRight size={15} />
                </div>

                <nav className="sidebar-nav" aria-label="Primary navigation">
                    <NavGroup items={primaryNavigation} />
                    <div className="nav-label">Library</div>
                    <NavGroup items={libraryNavigation} />
                </nav>

                <div className="sidebar-footer">
                    <NavLink className="sidebar-link" to="/settings">
                        <Settings size={18} />
                        <span>Settings</span>
                    </NavLink>
                    <NavLink className="sidebar-link" to="/help">
                        <CircleHelp size={18} />
                        <span>Help center</span>
                    </NavLink>
                    <div className="user-card">
                        <span className="user-avatar">SA</span>
                        <span className="user-copy">
                            <strong>Saket Agarwal</strong>
                            <small>Workspace owner</small>
                        </span>
                        <NavLink to="/profile" className="user-link" aria-label="Open profile">
                            <UserRound size={16} />
                        </NavLink>
                    </div>
                </div>
            </aside>

            <main className="main-shell" id="main-content" tabIndex="-1">
                <header className="topbar">
                    <button
                        className="icon-button mobile-menu"
                        onClick={() => setMobileOpen(true)}
                        aria-label="Open navigation"
                    >
                        <Menu size={19} />
                    </button>
                    <div className="breadcrumbs">
                        <span>Workspace</span>
                        <ChevronRight size={14} />
                        <strong>{getPageName(location.pathname)}</strong>
                    </div>
                    <div className="topbar-actions">
                        <button className="icon-button" onClick={toggleTheme} aria-label="Toggle theme">
                            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
                        </button>
                        <NavLink className="icon-button" to="/help" aria-label="Open help center" title="Help center">
                            <CircleHelp size={18} />
                        </NavLink>
                        <NavLink className="topbar-avatar" to="/profile">SA</NavLink>
                    </div>
                </header>
                <div className="page-content">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}

function NavGroup({ items }) {
    return items.map(({ label, path, icon: Icon }) => (
        <NavLink
            key={path}
            className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
            to={path}
        >
            <Icon size={18} />
            <span>{label}</span>
        </NavLink>
    ));
}

function getPageName(pathname) {
    const current = [...primaryNavigation, ...libraryNavigation].find((item) => item.path === pathname);
    if (pathname === "/profile") return "Profile";
    if (pathname === "/settings") return "Settings";
    if (pathname === "/help") return "Help center";
    if (pathname === "/status") return "API status";
    return current?.label ?? "Workspace";
}

export default AppShell;
