import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface AppEntry {
  id: string;
  name: string;
  description: string;
  url: string;
  status: "running" | "stopped" | "building";
  created_at: string;
}

interface ChatInterfaceProps {
  onAppCreated: (app: AppEntry) => void;
}

export function ChatInterface({ onAppCreated }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "system",
      content: "Describe the app you want to build. I can create web apps, APIs, dashboards, and more. Your app will be deployed to your Rainbow server with its own subdomain.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setLoading(true);

    try {
      const resp = await fetch("/api/apps/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          history: messages.filter((m) => m.role !== "system"),
        }),
      });

      const data = await resp.json();

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.message || "Working on it..." },
      ]);

      if (data.app) {
        onAppCreated(data.app);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, there was an error. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.messages}>
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              ...styles.message,
              ...(msg.role === "user" ? styles.userMessage : {}),
              ...(msg.role === "system" ? styles.systemMessage : {}),
            }}
          >
            <div style={styles.messageRole}>
              {msg.role === "user" ? "You" : msg.role === "system" ? "System" : "AI Builder"}
            </div>
            <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
          </div>
        ))}
        {loading && (
          <div style={styles.message}>
            <div style={styles.messageRole}>AI Builder</div>
            <div style={{ color: "var(--text-dim)" }}>Building your app...</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div style={styles.inputArea}>
        <input
          type="text"
          placeholder="Describe the app you want to build..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          style={styles.input}
          disabled={loading}
        />
        <button
          style={styles.sendBtn}
          onClick={sendMessage}
          disabled={loading || !input.trim()}
        >
          {loading ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: 400,
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  message: {
    padding: "10px 14px",
    borderRadius: "var(--radius)",
    background: "var(--bg)",
    fontSize: 14,
  },
  userMessage: {
    background: "rgba(99,102,241,0.1)",
    marginLeft: 40,
  },
  systemMessage: {
    background: "rgba(234,179,8,0.05)",
    border: "1px solid rgba(234,179,8,0.15)",
    fontSize: 13,
  },
  messageRole: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-dim)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: 4,
  },
  inputArea: {
    display: "flex",
    gap: 8,
    padding: 16,
    borderTop: "1px solid var(--border)",
  },
  input: {
    flex: 1,
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    color: "var(--text)",
    padding: "10px 14px",
    fontSize: 14,
    outline: "none",
  },
  sendBtn: {
    background: "var(--accent)",
    color: "#fff",
    border: "none",
    borderRadius: "var(--radius)",
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
};
