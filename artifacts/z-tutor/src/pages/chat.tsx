import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, ArrowLeft, Volume2, VolumeX, Loader2, Lock, Sparkles, StopCircle
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { ZSessionWithMessages, ZMessage, ZQuota } from "@/lib/types";

export default function Chat() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [, navigate] = useLocation();

  const [session, setSession] = useState<ZSessionWithMessages | null>(null);
  const [messages, setMessages] = useState<ZMessage[]>([]);
  const [quota, setQuota] = useState<ZQuota | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [quotaError, setQuotaError] = useState("");
  const [ttsLoading, setTtsLoading] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    Promise.all([
      apiFetch<ZSessionWithMessages>(`/z/sessions/${sessionId}`),
      apiFetch<ZQuota>("/z/quota"),
    ])
      .then(([s, q]) => {
        setSession(s);
        setMessages(s.messages ?? []);
        setQuota(q);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        setError("Failed to load session");
      });
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const stopAudio = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingId(null);
  }, []);

  const playTts = useCallback(async (msg: ZMessage) => {
    if (playingId === msg.id) {
      stopAudio();
      return;
    }
    stopAudio();
    setTtsLoading(msg.id);
    try {
      const { audioBase64, mimeType } = await apiFetch<{ audioBase64: string; mimeType: string }>("/z/tts", {
        method: "POST",
        body: JSON.stringify({ text: msg.content }),
      });
      const blob = new Blob([Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0))], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      setPlayingId(msg.id);
      audio.play();
      audio.onended = () => { setPlayingId(null); URL.revokeObjectURL(url); };
    } catch {
      // TTS might not be available
    } finally {
      setTtsLoading(null);
    }
  }, [playingId, stopAudio]);

  const sendMessage = async () => {
    if (!input.trim() || sending || !sessionId) return;
    const text = input.trim();
    setInput("");
    setSending(true);
    setError("");
    setQuotaError("");

    // Optimistic user message
    const optimisticUser: ZMessage = {
      id: `optimistic-${Date.now()}`,
      sessionId: sessionId!,
      role: "user",
      content: text,
      audioUrl: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      const aiMsg = await apiFetch<ZMessage>(`/z/sessions/${sessionId}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: text }),
      });

      // Replace optimistic + add real AI message
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticUser.id),
        { ...optimisticUser, id: `user-${Date.now()}` },
        aiMsg,
      ]);

      // Refresh quota
      apiFetch<ZQuota>("/z/quota").then(setQuota).catch(() => {});

      // Auto-play TTS if voice enabled
      if (voiceEnabled) {
        setTimeout(() => playTts(aiMsg), 100);
      }
    } catch (err: unknown) {
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));

      const e = err as { status?: number; body?: { error?: string; plan?: string } };
      if (e.status === 402) {
        setQuotaError(e.body?.error ?? "Question limit reached.");
      } else {
        setError("Failed to send message. Please try again.");
      }
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const quotaRemaining = quota?.remaining ?? null;
  const quotaLow = quotaRemaining !== null && quotaRemaining <= 3;

  return (
    <div className="h-screen bg-[#080B14] text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-white/5 flex-shrink-0">
        <button
          onClick={() => navigate("/")}
          className="p-2 rounded-lg hover:bg-white/5 text-white/40 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-sm flex-shrink-0">
          Z
        </div>

        {session && (
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white truncate">{session.subject}</div>
            <div className="text-xs text-white/40 truncate">{session.lesson} · {session.unit}</div>
          </div>
        )}

        <div className="flex items-center gap-2">
          {quota && (
            <div className={`text-xs px-2.5 py-1 rounded-full border ${
              quotaLow
                ? "bg-red-900/30 border-red-700/40 text-red-300"
                : "bg-white/5 border-white/10 text-white/40"
            }`}>
              {quotaRemaining} left
            </div>
          )}
          <button
            onClick={() => setVoiceEnabled((v) => !v)}
            className={`p-2 rounded-lg transition-colors ${
              voiceEnabled
                ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30"
                : "hover:bg-white/5 text-white/30 hover:text-white/60"
            }`}
            title={voiceEnabled ? "Voice on — click to disable" : "Enable voice playback"}
          >
            {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-7 h-7 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Welcome message */}
            {messages.length === 0 && session && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-lg mx-auto"
              >
                <div className="flex gap-3 items-start">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-sm flex-shrink-0">
                    Z
                  </div>
                  <div className="flex-1 bg-white/[0.04] border border-white/5 rounded-xl rounded-tl-sm p-4">
                    <p className="text-sm text-white/80 leading-relaxed">
                      Hi! I'm Z, your AI tutor for{" "}
                      <span className="text-indigo-300 font-medium">{session.subject}</span>.
                      Today we're covering{" "}
                      <span className="text-indigo-300 font-medium">{session.lesson}</span>{" "}
                      from <span className="text-indigo-300 font-medium">{session.unit}</span>.
                    </p>
                    <p className="text-sm text-white/60 mt-2 leading-relaxed">
                      Ask me anything about this topic and I'll guide you through it — 
                      step by step, hint by hint. What would you like to explore first?
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Messages */}
            {messages.map((msg, i) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                isLatest={i === messages.length - 1}
                onPlayTts={playTts}
                ttsLoading={ttsLoading === msg.id}
                isPlaying={playingId === msg.id}
              />
            ))}

            {/* Sending indicator */}
            {sending && (
              <div className="flex gap-3 items-start max-w-lg mx-auto">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-sm flex-shrink-0">
                  Z
                </div>
                <div className="bg-white/[0.04] border border-white/5 rounded-xl rounded-tl-sm p-4">
                  <div className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="w-1.5 h-1.5 bg-indigo-400/60 rounded-full animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Quota error */}
      <AnimatePresence>
        {quotaError && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="mx-4 mb-2 p-4 rounded-xl bg-amber-900/20 border border-amber-700/30"
          >
            <div className="flex items-start gap-3">
              <Lock className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-amber-200">{quotaError}</p>
                {quota?.plan === "free" && (
                  <button
                    onClick={() => navigate("/pricing")}
                    className="mt-2 text-xs text-amber-400 hover:text-amber-300 underline"
                  >
                    Upgrade to unlimited →
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="mx-4 mb-2 p-3 rounded-xl bg-red-900/20 border border-red-700/30 text-sm text-red-300"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input area */}
      <div className="border-t border-white/5 p-4 flex-shrink-0">
        <div className="max-w-2xl mx-auto flex gap-3 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={quotaError ? "Upgrade to continue asking questions" : "Ask Z anything about this lesson…"}
            disabled={!!quotaError || sending}
            rows={1}
            className="flex-1 bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-indigo-500/50 resize-none disabled:opacity-40 min-h-[48px] max-h-40 overflow-y-auto"
            style={{ height: "auto" }}
            onInput={(e) => {
              const el = e.target as HTMLTextAreaElement;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || sending || !!quotaError}
            className="p-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed rounded-xl transition-colors flex-shrink-0"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
        <p className="text-center text-xs text-white/15 mt-2">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  isLatest,
  onPlayTts,
  ttsLoading,
  isPlaying,
}: {
  msg: ZMessage;
  isLatest: boolean;
  onPlayTts: (msg: ZMessage) => void;
  ttsLoading: boolean;
  isPlaying: boolean;
}) {
  const isUser = msg.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 items-start max-w-2xl mx-auto ${isUser ? "flex-row-reverse" : ""}`}
    >
      {!isUser && (
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-sm flex-shrink-0">
          Z
        </div>
      )}

      <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"} flex-1`}>
        <div
          className={`px-4 py-3 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${
            isUser
              ? "bg-indigo-600/30 border border-indigo-500/30 text-indigo-100 rounded-tr-sm"
              : "bg-white/[0.04] border border-white/5 text-white/85 rounded-tl-sm"
          }`}
        >
          {msg.content}
        </div>

        {!isUser && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPlayTts(msg)}
              disabled={ttsLoading}
              className="flex items-center gap-1.5 text-xs text-white/25 hover:text-indigo-400 transition-colors py-0.5"
            >
              {ttsLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : isPlaying ? (
                <StopCircle className="w-3 h-3 text-indigo-400" />
              ) : (
                <Volume2 className="w-3 h-3" />
              )}
              {isPlaying ? "Stop" : ttsLoading ? "Loading…" : "Listen"}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
