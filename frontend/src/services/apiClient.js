import axios from "axios";
import { z } from "zod";

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8000/api",
    timeout: 5000,
    headers: { "Content-Type": "application/json" }
});

const translationSchema = z.object({
    text: z.string(),
    glosses: z.array(z.string()),
    motion_paths: z.array(z.string()),
    status: z.string(),
    unknown_glosses: z.array(z.string()).default([]),
    provider: z.string().default("manifest")
});

const apiStatusSchema = z.object({
    status: z.string(),
    service: z.string(),
    environment: z.string(),
    llm_provider: z.string(),
    checked_at: z.string(),
    motion_library: z.object({
        clips: z.number(),
        ready: z.number(),
        pending: z.number()
    }),
    llm: z.object({
        provider: z.string(),
        model: z.string(),
        mode: z.string(),
        configured: z.boolean(),
        api_key_configured: z.boolean(),
        responding: z.string(),
        requests: z.number(),
        successful_requests: z.number(),
        failed_requests: z.number(),
        last_status: z.string(),
        last_error: z.object({ code: z.string(), message: z.string() }).nullable(),
        last_latency_ms: z.number().nullable(),
        last_checked_at: z.string().nullable(),
        tokens: z.object({
            last_prompt: z.number().nullable(),
            last_completion: z.number().nullable(),
            last_total: z.number().nullable(),
            session_prompt: z.number(),
            session_completion: z.number(),
            session_total: z.number(),
            local_budget: z.number().nullable(),
            remaining: z.number().nullable(),
            quota_remaining: z.number().nullable(),
            quota_note: z.string()
        })
    })
});

export async function translateText(text, language = "en") {
    const response = await api.post("/translate/text", { text, language });
    return translationSchema.parse(response.data);
}

export async function getApiStatus() {
    const response = await api.get("/status");
    return apiStatusSchema.parse(response.data);
}

export async function testLlmConnection() {
    const response = await api.post("/status/llm-check");
    return apiStatusSchema.parse(response.data);
}

export async function login(credentials) {
    const response = await api.post("/auth/login", credentials);
    localStorage.setItem("signstream-token", response.data.access_token);
    return response.data;
}

export async function register(payload) {
    const response = await api.post("/auth/register", payload);
    localStorage.setItem("signstream-token", response.data.access_token);
    return response.data;
}

export async function uploadSource(file, sourceType) {
    const formData = new FormData();
    formData.append("file", file);
    const response = await api.post(`/translate/${sourceType}`, formData, {
        headers: { "Content-Type": "multipart/form-data" }
    });
    return response.data;
}

export async function convertRecordingToMp4(blob) {
    const formData = new FormData();
    formData.append("file", blob, "signstream-session.webm");
    const response = await api.post("/media/convert-mp4", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        responseType: "blob",
        timeout: 120000
    });
    return response.data;
}

export default api;
