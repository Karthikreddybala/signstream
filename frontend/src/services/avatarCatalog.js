const DEFAULT_AVATAR = {
    id: "avatar",
    name: "Avatar",
    path: "/avatar.vrm",
    description: "Default SignStream avatar"
};

export async function loadAvatarCatalog(path = "/avatars/manifest.json") {
    try {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`Avatar catalog request failed: ${response.status}`);

        const payload = await response.json();
        const avatars = Array.isArray(payload?.avatars)
            ? payload.avatars
                .map(normalizeAvatar)
                .filter(Boolean)
            : [];

        return avatars.length > 0 ? avatars : [DEFAULT_AVATAR];
    } catch {
        return [DEFAULT_AVATAR];
    }
}

function normalizeAvatar(avatar) {
    if (!avatar || typeof avatar !== "object") return null;

    const avatarPath = typeof avatar.path === "string" ? avatar.path.trim() : "";
    if (!avatarPath || !avatarPath.toLowerCase().endsWith(".vrm")) return null;

    return {
        id: String(avatar.id || avatarPath),
        name: String(avatar.name || avatarPath.split("/").pop()?.replace(/\.vrm$/i, "") || "Avatar"),
        path: avatarPath,
        description: String(avatar.description || "VRM avatar")
    };
}

export function getStoredAvatarPath() {
    try {
        return window.localStorage.getItem("signstream-avatar-path") || "";
    } catch {
        return "";
    }
}

export function storeAvatarPath(avatarPath) {
    try {
        window.localStorage.setItem("signstream-avatar-path", avatarPath);
    } catch {
        // Private browsing may deny storage; selection still works in memory.
    }
}
