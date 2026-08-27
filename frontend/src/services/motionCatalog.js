import { z } from "zod";

const manifestSchema = z.object({
    clips: z.array(z.object({
        gloss: z.string(),
        status: z.string().optional(),
        motionVariants: z.array(z.unknown()).optional()
    })).default([])
}).passthrough();

export async function loadMotionCatalog() {
    const response = await fetch("/motion/manifest.json", { cache: "no-store" });

    if (!response.ok) {
        throw new Error("Motion catalog could not be loaded.");
    }

    return manifestSchema.parse(await response.json());
}

export function readHistory() {
    try {
        const value = JSON.parse(localStorage.getItem("signstream-history") ?? "[]");
        return Array.isArray(value) ? value : [];
    } catch {
        return [];
    }
}

export function writeHistory(entry) {
    const next = [entry, ...readHistory()].slice(0, 20);
    localStorage.setItem("signstream-history", JSON.stringify(next));
    return next;
}

export function removeHistoryEntry(id) {
    const next = readHistory().filter((entry) => entry.id !== id);
    localStorage.setItem("signstream-history", JSON.stringify(next));
    return next;
}
