import { useCallback, useEffect, useRef, useState } from "react";
import {
    AudioLines,
    CheckCircle2,
    Download,
    FileText,
    Image,
    LifeBuoy,
    Mic,
    Square,
    Upload,
    Video,
    WandSparkles
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import AvatarViewport from "../components/avatar/AvatarViewport";
import { convertRecordingToMp4, translateText, uploadSource } from "../services/apiClient";

const workflows = {
    speech: {
        eyebrow: "Realtime speech",
        title: "Sign the conversation as it happens.",
        copy: "Speak naturally and the avatar will translate each completed phrase as it arrives.",
        icon: AudioLines,
        action: "Start listening",
        accept: "Audio input"
    },
    document: {
        eyebrow: "Document translation",
        title: "Bring your documents into the conversation.",
        copy: "Upload a PDF, DOCX, or TXT file and turn its content into an accessible signing workflow.",
        icon: FileText,
        action: "Extract text",
        accept: ".pdf,.docx,.txt"
    },
    image: {
        eyebrow: "Image translation",
        title: "Make visual text accessible.",
        copy: "Upload an image, extract its text, and prepare it for sign language translation.",
        icon: Image,
        action: "Run OCR",
        accept: "image/*"
    },
    help: {
        eyebrow: "Help center",
        title: "A calmer way to get unstuck.",
        copy: "Learn how SignStream works or reach out when you need help with a translation.",
        icon: LifeBuoy,
        action: "Contact support",
        accept: ""
    }
};

function WorkflowPage({ kind }) {
    const config = workflows[kind] ?? workflows.document;
    const Icon = config.icon;
    const navigate = useNavigate();
    const fileRef = useRef(null);
    const mediaStreamRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const speechRecognitionRef = useRef(null);
    const speechActiveRef = useRef(false);
    const recordingActiveRef = useRef(false);
    const processedResultIndexesRef = useRef(new Set());
    const audioChunksRef = useRef([]);
    const transcriptRef = useRef("");
    const availableGlossesRef = useRef([]);
    const translationQueueRef = useRef(Promise.resolve());
    const avatarActionsRef = useRef(null);
    const recordedUrlRef = useRef(null);
    const mp4UrlRef = useRef(null);
    const [file, setFile] = useState(null);
    const [started, setStarted] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [message, setMessage] = useState("");
    const [transcript, setTranscript] = useState("");
    const [liveGlosses, setLiveGlosses] = useState([]);
    const [liveUnknownGlosses, setLiveUnknownGlosses] = useState([]);
    const [activeGloss, setActiveGloss] = useState("");
    const [recordSession, setRecordSession] = useState(false);
    const [recordingActive, setRecordingActive] = useState(false);
    const [recordedSession, setRecordedSession] = useState(null);
    const [mp4Session, setMp4Session] = useState(null);
    const [convertingMp4, setConvertingMp4] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    const setRecordingFlag = (value) => {
        recordingActiveRef.current = value;
        setRecordingActive(value);
    };

    const clearRecordedSession = useCallback(() => {
        if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current);
        if (mp4UrlRef.current) URL.revokeObjectURL(mp4UrlRef.current);
        recordedUrlRef.current = null;
        mp4UrlRef.current = null;
        setRecordedSession(null);
        setMp4Session(null);
    }, []);

    useEffect(() => () => {
        speechActiveRef.current = false;
        speechRecognitionRef.current?.stop();
        mediaRecorderRef.current?.stop();
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        void avatarActionsRef.current?.stopRecording?.();
        if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current);
        if (mp4UrlRef.current) URL.revokeObjectURL(mp4UrlRef.current);
    }, []);

    const handleAvatarReady = useCallback(({ glosses, startRecording, stopRecording }) => {
        availableGlossesRef.current = glosses;
        avatarActionsRef.current = { startRecording, stopRecording };
    }, []);

    const handleAvatarSequenceChange = useCallback(({ gloss }) => {
        setActiveGloss(gloss ?? "");
    }, []);

    const handleFile = (event) => {
        setFile(event.target.files?.[0] ?? null);
        setMessage("");
    };

    const handleDrop = (event) => {
        event.preventDefault();
        setIsDragging(false);
        const droppedFile = event.dataTransfer.files?.[0];
        if (droppedFile) {
            setFile(droppedFile);
            setMessage("");
        }
    };

    const appendLiveGlosses = (glosses) => {
        const nextGlosses = glosses.filter((gloss) => typeof gloss === "string" && gloss.trim());
        if (nextGlosses.length === 0) return;
        setLiveGlosses((current) => [...current, ...nextGlosses]);
    };

    const processLiveSegment = (segment) => {
        const text = segment.trim();
        if (!text) return;

        translationQueueRef.current = translationQueueRef.current
            .then(async () => {
                try {
                    const response = await translateText(text);
                    appendLiveGlosses(response.glosses ?? []);
                    if (response.unknown_glosses?.length) {
                        setLiveUnknownGlosses((current) => [...new Set([...current, ...response.unknown_glosses])]);
                    }
                } catch {
                    const fallback = findLocalGlosses(text, availableGlossesRef.current);
                    appendLiveGlosses(fallback);
                    if (fallback.length === 0) {
                        setMessage("Live translation is waiting for the API; the recording is still active.");
                    }
                }
            })
            .catch(() => {});
    };

    const startSpeechRecognition = () => {
        const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setMessage("Live browser recognition is unavailable. The recording will be transcribed when you stop.");
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-IN";
        recognition.onresult = (event) => {
            let nextTranscript = "";
            for (let index = 0; index < event.results.length; index += 1) {
                nextTranscript += `${event.results[index][0].transcript} `;
            }
            const cleanTranscript = nextTranscript.trim();
            setTranscript(cleanTranscript);
            transcriptRef.current = cleanTranscript;

            for (let index = event.resultIndex; index < event.results.length; index += 1) {
                const result = event.results[index];
                if (!result.isFinal || processedResultIndexesRef.current.has(index)) continue;
                processedResultIndexesRef.current.add(index);
                processLiveSegment(result[0].transcript);
            }
        };
        recognition.onerror = (event) => {
            if (event.error !== "aborted") {
                setMessage("Browser speech recognition paused; the recorded audio will still be transcribed when you stop.");
            }
        };
        recognition.onend = () => {
            if (speechActiveRef.current) {
                processedResultIndexesRef.current.clear();
                try { recognition.start(); } catch { return; }
            }
        };
        speechRecognitionRef.current = recognition;
        try {
            recognition.start();
        } catch {
            setMessage("Live speech recognition could not be started.");
        }
    };

    const startSessionRecording = async () => {
        if (!avatarActionsRef.current?.startRecording) {
            setMessage("The avatar is still loading. Try recording again in a moment.");
            return false;
        }
        try {
            avatarActionsRef.current.startRecording(mediaStreamRef.current);
            setRecordingFlag(true);
            return true;
        } catch (error) {
            setMessage(error?.message || "Session recording is not supported in this browser.");
            setRecordSession(false);
            return false;
        }
    };

    const stopSessionRecording = async ({ disableToggle = true } = {}) => {
        if (!recordingActiveRef.current || !avatarActionsRef.current?.stopRecording) return null;
        try {
            const blob = await avatarActionsRef.current.stopRecording();
            if (blob?.size) {
                const url = URL.createObjectURL(blob);
                recordedUrlRef.current = url;
                setRecordedSession({ blob, url, type: blob.type || "video/webm" });
                setMp4Session(null);
            }
            return blob;
        } catch (error) {
            setMessage(error?.message || "The live session could not be saved.");
            return null;
        } finally {
            setRecordingFlag(false);
            if (disableToggle) setRecordSession(false);
        }
    };

    const finishSpeech = async () => {
        const recorder = mediaRecorderRef.current;
        const recognition = speechRecognitionRef.current;
        speechActiveRef.current = false;
        recognition?.stop();
        speechRecognitionRef.current = null;

        await stopSessionRecording();

        if (recorder && recorder.state !== "inactive") {
            setProcessing(true);
            setMessage("Finishing your live session...");
            recorder.stop();
        } else {
            mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
            setStarted(false);
            setMessage(transcriptRef.current.trim() ? "Live session finished." : "No speech was captured.");
        }
    };

    const startSpeech = async () => {
        if (speechActiveRef.current) {
            await finishSpeech();
            return;
        }

        if (!navigator.mediaDevices?.getUserMedia) {
            setMessage("This browser does not support microphone access.");
            return;
        }

        try {
            clearRecordedSession();
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;
            speechActiveRef.current = true;
            processedResultIndexesRef.current.clear();
            setTranscript("");
            transcriptRef.current = "";
            setLiveGlosses([]);
            setLiveUnknownGlosses([]);
            setActiveGloss("");
            setStarted(true);
            setMessage("Listening. Completed phrases will play automatically on the avatar.");
            startSpeechRecognition();

            if (window.MediaRecorder) {
                const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
                    .find((candidate) => MediaRecorder.isTypeSupported?.(candidate));
                const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
                audioChunksRef.current = [];
                recorder.ondataavailable = (event) => {
                    if (event.data.size > 0) audioChunksRef.current.push(event.data);
                };
                recorder.onstop = async () => {
                    mediaRecorderRef.current = null;
                    const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
                    const extension = blob.type.includes("mp4") ? "m4a" : "webm";
                    const speechFile = new File([blob], `speech.${extension}`, { type: blob.type || "audio/webm" });
                    try {
                        const response = await uploadSource(speechFile, "speech");
                        const text = response.normalized_text || transcriptRef.current.trim();
                        if (text) {
                            setTranscript(text);
                            transcriptRef.current = text;
                        }
                        setMessage("Live session finished. Your recording is ready below.");
                    } catch {
                        setMessage(transcriptRef.current.trim()
                            ? "Live session finished. Browser recognition was used for the transcript."
                            : "Speech transcription failed. Check the configured LLM provider and try again.");
                    } finally {
                        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
                        mediaStreamRef.current = null;
                        setProcessing(false);
                        setStarted(false);
                    }
                };
                mediaRecorderRef.current = recorder;
                recorder.start();
            }

            if (recordSession) await startSessionRecording();
        } catch (error) {
            speechActiveRef.current = false;
            const reason = error?.name === "NotAllowedError"
                ? "Microphone permission was denied. Allow access in the browser settings and try again."
                : error?.name === "NotFoundError"
                    ? "No microphone was found on this device."
                    : "Microphone access could not be started.";
            setMessage(reason);
        }
    };

    const handleRecordToggle = async (event) => {
        const enabled = event.target.checked;
        setRecordSession(enabled);
        if (enabled && speechActiveRef.current) {
            await startSessionRecording();
        } else if (!enabled && recordingActiveRef.current) {
            await stopSessionRecording();
        }
    };

    const processSource = async () => {
        if (kind === "speech") {
            await startSpeech();
            return;
        }
        if (!file) return;
        setProcessing(true);
        setMessage("");
        try {
            const response = await uploadSource(file, kind);
            if (response.normalized_text) {
                navigate(`/translate?text=${encodeURIComponent(response.normalized_text)}`);
                return;
            }
            setMessage("The source was processed, but no readable text was found.");
        } catch (error) {
            const detail = error?.response?.data?.detail;
            const providerMessage = typeof detail === "object" ? detail.message : detail;
            setMessage(providerMessage || "API unavailable; the selected source is ready for local review.");
        } finally {
            setStarted(true);
            setProcessing(false);
        }
    };

    const downloadWebm = () => {
        if (!recordedSession?.blob) return;
        downloadBlob(recordedSession.blob, "signstream-session.webm");
    };

    const downloadMp4 = async () => {
        if (!recordedSession?.blob) return;
        if (mp4Session?.blob) {
            downloadBlob(mp4Session.blob, "signstream-session.mp4");
            return;
        }
        setConvertingMp4(true);
        setMessage("Converting the session to MP4...");
        try {
            const blob = await convertRecordingToMp4(recordedSession.blob);
            const url = URL.createObjectURL(blob);
            mp4UrlRef.current = url;
            setMp4Session({ blob, url });
            downloadBlob(blob, "signstream-session.mp4");
            setMessage("MP4 download is ready.");
        } catch {
            setMessage("MP4 conversion is unavailable. You can still download the playable WebM recording.");
        } finally {
            setConvertingMp4(false);
        }
    };

    const hasLiveSession = started || Boolean(transcript) || liveGlosses.length > 0;

    return (
        <div className="page-stack workflow-page">
            <section className="page-intro">
                <div>
                    <span className="eyebrow">{config.eyebrow}</span>
                    <h1>{config.title}</h1>
                    <p>{config.copy}</p>
                </div>
                <span className="feature-icon feature-icon-blue"><Icon size={21} /></span>
            </section>
            <section className={`workflow-layout ${kind === "speech" ? "speech-workflow-layout" : ""}`}>
                <div className="panel-card upload-card">
                    <div className="upload-card-icon"><Icon size={24} /></div>
                    <h2>{getSourceTitle(kind)}</h2>
                    <p>{getSourceCopy(kind)}</p>
                    {kind === "help" ? (
                        <div className="help-actions">
                            <Link className="button button-primary" to="/translate">Open translation studio</Link>
                            <button className="button button-secondary" onClick={() => setStarted(true)}>Read common questions</button>
                        </div>
                    ) : kind === "speech" ? (
                        <>
                            <button
                                className={`button ${started ? "button-secondary" : "button-primary"} button-large`}
                                onClick={processSource}
                                disabled={processing}
                            >
                                {started ? <Square size={16} fill="currentColor" /> : <Mic size={17} />}
                                {started ? "Stop listening" : config.action}
                            </button>
                            <label className="record-toggle">
                                <input type="checkbox" checked={recordSession} onChange={handleRecordToggle} />
                                <span className="record-toggle-copy">
                                    <strong>{recordingActive ? "Recording live session" : "Record live session"}</strong>
                                    <small>{recordingActive ? "Avatar and microphone are being captured." : "Keep a playable avatar video when you stop."}</small>
                                </span>
                                <Video size={16} />
                            </label>
                        </>
                    ) : (
                        <>
                            <input ref={fileRef} className="visually-hidden" type="file" accept={config.accept} onChange={handleFile} />
                            <button className={`dropzone ${isDragging ? "is-dragging" : ""}`} type="button" onClick={() => fileRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop} aria-label={file ? `Selected file: ${file.name}` : "Choose a file or drag one here"}>
                                <span className="dropzone-icon"><Upload size={20} /></span>
                                <strong>{file ? file.name : "Choose a file or drop it here"}</strong>
                                <small>{file ? `${Math.round(file.size / 1024)} KB ready` : config.accept.replaceAll(",", " · ")}</small>
                            </button>
                            <button className="button button-primary button-large" disabled={!file || processing} onClick={processSource}>
                                <WandSparkles size={17} /> {config.action}
                            </button>
                        </>
                    )}
                </div>
                <div className="panel-card workflow-status-card" aria-live="polite">
                    <div className="panel-heading">
                        <div>
                            <span className="eyebrow">Workflow status</span>
                            <h2>{hasLiveSession ? "Live translation active" : "Waiting for input"}</h2>
                        </div>
                        <span className={`status-pill ${hasLiveSession ? "status-ready" : "status-muted"}`}>
                            <span className="status-dot" /> {hasLiveSession ? "Ready" : "Idle"}
                        </span>
                    </div>
                    <div className="workflow-checklist">
                        <CheckItem label="Input received" done={Boolean(file || hasLiveSession)} />
                        <CheckItem label="Content prepared" done={hasLiveSession} />
                        <CheckItem label="Motion queue" done={kind === "speech" ? liveGlosses.length > 0 : false} />
                    </div>
                    {hasLiveSession && (
                        <div className="workflow-next">
                            <span className="status-dot status-dot-green" />
                            <span>
                                <strong>{kind === "speech" && started ? "Avatar is signing live" : "Your source is ready"}</strong>
                                <small>{kind === "speech" && started ? `${liveGlosses.length} glosses queued${activeGloss ? ` · now signing ${activeGloss}` : ""}` : "Continue in the translation studio to review the avatar."}</small>
                            </span>
                            {!started && transcript ? <Link className="text-link" to={`/translate?text=${encodeURIComponent(transcript)}`}>Continue →</Link> : null}
                        </div>
                    )}
                    {transcript && <div className="workflow-transcript"><span className="eyebrow">Live transcript</span><p>{transcript}</p></div>}
                    {liveUnknownGlosses.length > 0 && <p className="workflow-message">No motion clip found for: {liveUnknownGlosses.join(", ")}</p>}
                    {message && <p className="workflow-message">{message}</p>}
                </div>
                {kind === "speech" && (
                    <AvatarViewport
                        selectedGloss={activeGloss}
                        sequenceGlosses={liveGlosses}
                        sequenceLoop={false}
                        streamSequence
                        onReady={handleAvatarReady}
                        onSequenceChange={handleAvatarSequenceChange}
                    />
                )}
            </section>
            {kind === "speech" && recordedSession?.url && (
                <section className="panel-card recorded-session-card">
                    <div className="panel-heading">
                        <div>
                            <span className="eyebrow">Recorded session</span>
                            <h2>Review or download your live signing</h2>
                        </div>
                        <span className="status-pill status-ready">Playable</span>
                    </div>
                    <video className="recorded-session-video" controls src={recordedSession.url} />
                    <div className="recorded-session-actions">
                        <button className="button button-secondary" onClick={downloadWebm}><Download size={16} /> Download WebM</button>
                        <button className="button button-primary" onClick={downloadMp4} disabled={convertingMp4}>
                            <Download size={16} /> {convertingMp4 ? "Converting MP4..." : "Download MP4"}
                        </button>
                    </div>
                </section>
            )}
        </div>
    );
}

function getSourceTitle(kind) {
    if (kind === "speech") return "Your microphone";
    if (kind === "help") return "How can we help?";
    return "Add your source";
}

function getSourceCopy(kind) {
    if (kind === "speech") return "Speak into the microphone and watch the avatar respond phrase by phrase.";
    if (kind === "help") return "Find quick answers or open a conversation with the team.";
    return "Choose a file to begin. Your content stays in this workspace.";
}

function CheckItem({ label, done }) {
    return (
        <div className={`check-item ${done ? "done" : ""}`}>
            <span>{done ? <CheckCircle2 size={17} /> : <span className="check-circle" />}</span>
            <strong>{label}</strong>
            <small>{done ? "Complete" : "Pending"}</small>
        </div>
    );
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function findLocalGlosses(text, availableGlosses) {
    const words = text.toLowerCase().match(/[a-z]+(?:['-][a-z]+)*/g) ?? [];
    const candidates = availableGlosses
        .map((gloss) => ({ gloss, words: gloss.toLowerCase().match(/[a-z]+(?:['-][a-z]+)*/g) ?? [] }))
        .filter((candidate) => candidate.words.length > 0)
        .sort((left, right) => right.words.length - left.words.length);
    const ordered = [];

    for (let index = 0; index < words.length;) {
        const match = candidates.find((candidate) => candidate.words.every(
            (word, offset) => words[index + offset]
                && wordForms(words[index + offset]).some((form) => wordForms(word).includes(form))
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

function wordForms(word) {
    const forms = new Set([word]);
    if (word.length > 3 && word.endsWith("ies")) forms.add(`${word.slice(0, -3)}y`);
    if (word.length > 4 && word.endsWith("ing")) {
        const stem = word.slice(0, -3);
        forms.add(stem);
        if (stem.length > 3 && stem.at(-1) === stem.at(-2)) forms.add(stem.slice(0, -1));
        if (stem && !/[aeiou]$/.test(stem)) forms.add(`${stem}e`);
    }
    if (word.length > 3 && word.endsWith("es")) forms.add(word.slice(0, -2));
    if (word.length > 2 && word.endsWith("s")) forms.add(word.slice(0, -1));
    return [...forms];
}

export default WorkflowPage;
