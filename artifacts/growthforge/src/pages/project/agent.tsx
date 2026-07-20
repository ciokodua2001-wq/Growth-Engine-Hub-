import { useParams } from "wouter";
import {
  useGetAgentHistory,
  useAgentChat,
  getGetAgentHistoryQueryKey,
} from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, User, Zap, ChevronRight, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useRef, useEffect } from "react";
import { useTrialUsage } from "@/hooks/use-trial-usage";
import { UpgradeModal } from "@/components/ui/upgrade-modal";
import { Link } from "wouter";

const MESSAGE_LIMIT = 10;

const EXAMPLE_PROMPTS = [
  { label: "Analyze my business and website.", icon: "🔍" },
  { label: "Discover my top 3 competitors.", icon: "🏆" },
  { label: "Create a marketing strategy.", icon: "📈" },
  { label: "Generate 5 social media posts.", icon: "💬" },
  { label: "Produce a Promotional Video.", icon: "🎬" },
];

const QUICK_CHIPS = [
  "Analyze my business.",
  "Discover competitors.",
  "Generate social posts.",
  "Create email campaign.",
  "Produce a Promotional Video.",
];

const CAPABILITIES = [
  "Analyze Your Business",
  "Discover Competitors",
  "Create Marketing Strategies",
  "Generate Content",
  "Create Promotional Videos",
  "Build Campaign Ideas",
];

function ForgeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L4 6V12C4 16.4 7.4 20.5 12 22C16.6 20.5 20 16.4 20 12V6L12 2Z" fill="currentColor" opacity="0.15" />
      <path d="M12 2L4 6V12C4 16.4 7.4 20.5 12 22C16.6 20.5 20 16.4 20 12V6L12 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9 12L11 14L15 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MessageContent({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />;
        if (line.startsWith("- ")) {
          return (
            <div key={i} className="flex gap-2 items-start">
              <span className="text-primary mt-0.5 shrink-0">•</span>
              <span>{line.slice(2)}</span>
            </div>
          );
        }
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

export default function ProjectAgent() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [message, setMessage] = useState("");
  const [rows, setRows] = useState(1);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { data: history, isLoading } = useGetAgentHistory(projectId, { query: { queryKey: getGetAgentHistoryQueryKey(projectId), enabled: !!projectId } });
  const { usage, refetch: refetchUsage } = useTrialUsage(projectId);
  const agentChat = useAgentChat();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, agentChat.isPending]);

  const messagesUsed = history?.filter((m) => m.role === "user").length ?? 0;
  const messagesRemaining = Math.max(0, MESSAGE_LIMIT - messagesUsed);
  const limitReached = messagesUsed >= MESSAGE_LIMIT;

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    const lineCount = e.target.value.split("\n").length;
    setRows(Math.min(Math.max(lineCount, 1), 5));
  };

  const handleSend = (msg?: string) => {
    const text = msg ?? message;
    if (!text.trim() || agentChat.isPending) return;
    if (limitReached) {
      setShowUpgrade(true);
      return;
    }
    setMessage("");
    setRows(1);
    agentChat.mutate(
      { id: projectId, data: { message: text } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAgentHistoryQueryKey(projectId) });
          refetchUsage();
        },
        onError: () => toast({ title: "Error", description: "Forge failed to respond.", variant: "destructive" }),
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasMessages = history && history.length > 0;

  return (
    <div className="flex flex-col h-full max-h-screen bg-background">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center text-primary">
            <ForgeIcon size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black tracking-tight">Forge</h1>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded-full">AI Agent</span>
            </div>
            <p className="text-xs text-muted-foreground">Your autonomous marketing co-pilot</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {/* Message counter */}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${
              limitReached
                ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                : messagesRemaining <= 5
                ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                : "bg-primary/8 border-primary/20 text-primary/80"
            }`}>
              <MessageSquare className="w-3 h-3" />
              {messagesRemaining} / {MESSAGE_LIMIT} messages
            </div>
            <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-emerald-400 font-medium">Online</span>
            </div>
          </div>
        </div>

        {/* Message limit progress bar */}
        <div className="mt-3">
          <div className="h-1 rounded-full bg-white/5 overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${(messagesUsed / MESSAGE_LIMIT) * 100}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              style={{
                background: limitReached
                  ? "#f59e0b"
                  : messagesRemaining <= 5
                  ? "linear-gradient(90deg, #f59e0b, #ef4444)"
                  : "linear-gradient(90deg, #00E676, #00D4FF)",
              }}
            />
          </div>
        </div>
      </div>

      {/* Limit reached banner */}
      <AnimatePresence>
        {limitReached && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="px-6 py-3 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between"
          >
            <div className="flex items-center gap-2 text-amber-300 text-sm">
              <Zap className="w-4 h-4" />
              <span>You've used all 10 trial messages.</span>
            </div>
            <Link
              href="/plans"
              className="px-3 py-1 rounded-full bg-[#00E676] text-black text-xs font-bold hover:bg-[#14F195] transition-colors"
            >
              Upgrade
            </Link>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : !hasMessages ? (
          /* Welcome empty state */
          <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", duration: 0.6 }}
              className="h-20 w-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-5"
            >
              <ForgeIcon size={36} />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.4 }}
              className="mb-6"
            >
              <h2 className="text-3xl font-black mb-1">Hi, I'm Forge.</h2>
              <p className="text-muted-foreground text-sm">I can help you:</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="grid grid-cols-2 gap-2 mb-5 w-full max-w-sm"
            >
              {CAPABILITIES.map((cap, i) => (
                <motion.div
                  key={cap}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.25 + i * 0.05 }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/15 text-xs text-primary/80"
                >
                  <span className="text-primary">✅</span>
                  {cap}
                </motion.div>
              ))}
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mb-6 px-4 py-2.5 rounded-full bg-primary/8 border border-primary/20 text-sm text-primary/80 font-medium"
            >
              Free Trial Includes: <strong className="text-primary">{messagesRemaining} AI Messages</strong>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55, duration: 0.4 }}
              className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-md"
            >
              {EXAMPLE_PROMPTS.map((prompt, i) => (
                <motion.button
                  key={prompt.label}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 + i * 0.06 }}
                  onClick={() => handleSend(prompt.label)}
                  disabled={agentChat.isPending || limitReached}
                  className="group flex items-center gap-3 text-left px-4 py-3 rounded-xl bg-card border border-border hover:border-primary/40 hover:bg-primary/5 transition-all disabled:opacity-50"
                >
                  <span className="text-lg">{prompt.icon}</span>
                  <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors flex-1">
                    {prompt.label}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary/60 transition-colors shrink-0" />
                </motion.button>
              ))}
            </motion.div>
          </div>
        ) : (
          /* Chat messages */
          <div className="p-6 space-y-5">
            <AnimatePresence initial={false}>
              {history.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="h-8 w-8 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center text-primary shrink-0 mt-0.5">
                      <ForgeIcon size={16} />
                    </div>
                  )}

                  <div className={`max-w-[72%] flex flex-col gap-1.5 ${msg.role === "user" ? "items-end" : "items-start"}`}>
                    <div
                      className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground rounded-tr-sm font-medium"
                          : "bg-card border border-border text-foreground rounded-tl-sm"
                      }`}
                    >
                      {msg.role === "assistant" ? (
                        <MessageContent content={msg.content} />
                      ) : (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      )}
                    </div>
                    {msg.actionResult && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.15 }}
                        className="flex items-center gap-1.5 bg-primary/10 border border-primary/20 text-primary rounded-full px-3 py-1 text-xs font-medium"
                      >
                        <Zap className="h-3 w-3 shrink-0" />
                        <span>{msg.actionResult}</span>
                      </motion.div>
                    )}
                  </div>

                  {msg.role === "user" && (
                    <div className="h-8 w-8 rounded-lg bg-secondary border border-border flex items-center justify-center shrink-0 mt-0.5">
                      <User className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {agentChat.isPending && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-3 justify-start"
              >
                <div className="h-8 w-8 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                  <ForgeIcon size={16} />
                </div>
                <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3.5">
                  <div className="flex gap-1.5 items-center">
                    <motion.span className="h-2 w-2 rounded-full bg-primary" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0 }} />
                    <motion.span className="h-2 w-2 rounded-full bg-primary" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }} />
                    <motion.span className="h-2 w-2 rounded-full bg-primary" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }} />
                    <span className="ml-2 text-xs text-muted-foreground">Forge is building...</span>
                  </div>
                </div>
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Quick chips */}
      {hasMessages && !agentChat.isPending && !limitReached && (
        <div className="px-6 pb-2 flex gap-2 overflow-x-auto shrink-0 scrollbar-none">
          {QUICK_CHIPS.map((chip) => (
            <button
              key={chip}
              onClick={() => handleSend(chip)}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-secondary border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-all whitespace-nowrap"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* Input bar */}
      <div className="p-4 pt-3 border-t border-border/60 shrink-0">
        <div className={`flex gap-3 items-end rounded-2xl px-4 py-3 transition-all ${
          limitReached
            ? "bg-secondary/30 border border-border/40 opacity-60"
            : "bg-secondary/60 border border-border focus-within:border-primary/40 focus-within:bg-secondary"
        }`}>
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            disabled={limitReached}
            placeholder={limitReached ? "Message limit reached — upgrade to continue" : "Ask Forge anything..."}
            rows={rows}
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground/60 focus:outline-none resize-none leading-relaxed disabled:cursor-not-allowed"
          />
          <button
            onClick={() => limitReached ? setShowUpgrade(true) : handleSend()}
            disabled={(!message.trim() && !limitReached) || agentChat.isPending}
            className="h-9 w-9 flex items-center justify-center bg-primary hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed text-primary-foreground rounded-xl transition-all shrink-0 mb-0.5"
          >
            {agentChat.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="text-center text-[10px] text-muted-foreground/40 mt-2">
          {limitReached
            ? "Upgrade to unlock unlimited AI messages."
            : "Forge executes actions and saves outputs to your project modules automatically."}
        </p>
      </div>

      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        feature="AI messages"
        limit={MESSAGE_LIMIT}
        limitLabel="messages"
      />
    </div>
  );
}
