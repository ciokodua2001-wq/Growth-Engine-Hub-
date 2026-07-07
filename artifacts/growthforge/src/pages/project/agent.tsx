import { useParams } from "wouter";
import {
  useGetAgentHistory,
  useAgentChat,
  getGetAgentHistoryQueryKey,
} from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Bot, Send, User, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useRef, useEffect } from "react";

const QUICK_COMMANDS = [
  "Generate 9 marketing videos",
  "Create 30 days of social content",
  "Discover my top competitors",
  "Generate email sequences",
  "Build a performance report",
  "Launch Meta ad campaigns",
];

export default function ProjectAgent() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [message, setMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { data: history, isLoading } = useGetAgentHistory(projectId, { query: { enabled: !!projectId } });
  const agentChat = useAgentChat();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const handleSend = (msg?: string) => {
    const text = msg ?? message;
    if (!text.trim() || agentChat.isPending) return;
    setMessage("");
    agentChat.mutate(
      { id: projectId, data: { message: text } },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetAgentHistoryQueryKey(projectId) }),
        onError: () => toast({ title: "Error", description: "Agent failed to respond.", variant: "destructive" }),
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full max-h-screen">
      {/* Header */}
      <div className="p-6 pb-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-black">AI Marketing Agent</h1>
            <p className="text-xs text-muted-foreground">Your autonomous marketing co-pilot</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-muted-foreground">Online</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : !history || history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Zap className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-bold mb-2">Your AI Marketing Agent</h2>
            <p className="text-muted-foreground text-sm max-w-sm mb-8">
              Tell me what to do and I'll execute it. Generate videos, create campaigns, analyze competitors — just ask.
            </p>
            <div className="grid grid-cols-2 gap-2 max-w-lg">
              {QUICK_COMMANDS.map((cmd) => (
                <button
                  key={cmd}
                  onClick={() => handleSend(cmd)}
                  className="text-left px-3 py-2.5 rounded-xl bg-secondary hover:bg-secondary/80 border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {cmd}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <AnimatePresence initial={false}>
              {history.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                  )}
                  <div className={`max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${msg.role === "user" ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-card border border-border text-foreground rounded-tl-sm"}`}>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    {msg.actionResult && (
                      <div className="mt-2 pt-2 border-t border-primary/20 text-xs opacity-80 flex items-center gap-1">
                        <Zap className="h-3 w-3" /> {msg.actionResult}
                      </div>
                    )}
                  </div>
                  {msg.role === "user" && (
                    <div className="h-8 w-8 rounded-lg bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                      <User className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {agentChat.isPending && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3 justify-start">
                <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3">
                  <div className="flex gap-1.5 items-center">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </motion.div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick commands row (when history exists) */}
      {history && history.length > 0 && (
        <div className="px-6 pb-2 flex gap-2 overflow-x-auto shrink-0">
          {QUICK_COMMANDS.slice(0, 4).map((cmd) => (
            <button
              key={cmd}
              onClick={() => handleSend(cmd)}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-secondary border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
            >
              {cmd}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="p-6 pt-3 border-t border-border shrink-0">
        <div className="flex gap-3 items-end">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Tell your AI agent what to do... (Enter to send)"
            rows={1}
            className="flex-1 bg-secondary border border-border rounded-xl px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none max-h-32"
          />
          <button
            onClick={() => handleSend()}
            disabled={!message.trim() || agentChat.isPending}
            className="h-11 w-11 flex items-center justify-center bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-xl transition-colors shrink-0"
          >
            {agentChat.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
