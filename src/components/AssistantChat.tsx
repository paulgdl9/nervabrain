"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowUp, History, Pencil, Plus, Trash2 } from "lucide-react";
import { askAssistantAction, deleteAssistantChatAction, loadAssistantChatAction, saveAssistantChatAction } from "@/app/actions";
import { CustomSelect } from "@/components/CustomSelect";
import { useLanguage } from "@/components/LanguageProvider";
import { MarkdownView } from "@/components/MarkdownView";
import type { TranslationKey } from "@/lib/i18n";
import type { AssistantChatSummary } from "@/lib/assistant-chats";

type ChatMessage = { role: "user" | "assistant"; content: string };
type AssistantModelCatalog = { claude: { id: string; label: string }[]; codex: { id: string; label: string }[] };
type Engine = "claude" | "codex" | "";

const OPTIONS_KEY = "second-brain:assistant-options";
const CURRENT_CHAT_KEY = "second-brain:assistant-current";
const MAX_INPUT_LENGTH = 4000;

// Single source of truth for which reasoning-effort levels each engine's
// installed CLI accepts: claude (`--effort`) supports xhigh/max, codex
// (`model_reasoning_effort`) supports xhigh but rejects max/minimal. "" means
// no model picked yet, so only the safe intersection is offered.
const EFFORT_OPTIONS: { value: string; labelKey: TranslationKey; engines: Engine[] }[] = [
  { value: "", labelKey: "assistant.effortAuto", engines: ["", "claude", "codex"] },
  { value: "low", labelKey: "assistant.effortLow", engines: ["", "claude", "codex"] },
  { value: "medium", labelKey: "assistant.effortMedium", engines: ["", "claude", "codex"] },
  { value: "high", labelKey: "assistant.effortHigh", engines: ["", "claude", "codex"] },
  { value: "xhigh", labelKey: "assistant.effortXhigh", engines: ["claude", "codex"] },
  { value: "max", labelKey: "assistant.effortMax", engines: ["claude"] },
];

function engineOf(modelValue: string): Engine {
  const separator = modelValue.indexOf(":");
  return separator > 0 ? (modelValue.slice(0, separator) as Engine) : "";
}

function createChatId() {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function AssistantChat({
  models,
  defaultEngine,
  initialChats,
  initialPrompt = "",
}: {
  models: AssistantModelCatalog;
  defaultEngine: Engine;
  initialChats: AssistantChatSummary[];
  initialPrompt?: string;
}) {
  const { t, locale } = useLanguage();
  const [chatId, setChatId] = useState<string | null>(null);
  const [chats, setChats] = useState<AssistantChatSummary[]>(initialChats);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState(initialPrompt);
  const [error, setError] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [optionsHydrated, setOptionsHydrated] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [pending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const modelOptions = useMemo(() => {
    const options = [{ value: "", label: t("assistant.modelAuto") }];
    for (const entry of models.claude) options.push({ value: `claude:${entry.id}`, label: `Claude · ${entry.label}` });
    for (const entry of models.codex) options.push({ value: `codex:${entry.id}`, label: `Codex · ${entry.label}` });
    return options;
  }, [models, t]);
  const effectiveEngine = engineOf(model) || defaultEngine;
  const effortOptions = useMemo(
    () => EFFORT_OPTIONS.filter((option) => option.engines.includes(effectiveEngine))
      .map((option) => ({ value: option.value, label: t(option.labelKey) })),
    [effectiveEngine, t],
  );
  const hasModelChoice = models.claude.length > 0 || models.codex.length > 0;

  function handleModelChange(value: string) {
    setModel(value);
    const nextEngine = engineOf(value) || defaultEngine;
    const stillValid = EFFORT_OPTIONS.some((option) => option.value === effort && option.engines.includes(nextEngine));
    if (effort && !stillValid) setEffort("");
  }

  // Restore whichever conversation this device was last on, identified by an
  // id pointer in localStorage (shared across tabs, not across devices — the
  // conversation itself lives server-side so every device sees it once it
  // loads this pointer or picks it from history).
  useEffect(() => {
    let cancelled = false;
    let storedId = "";
    try {
      if (initialPrompt) {
        window.localStorage.removeItem(CURRENT_CHAT_KEY);
        return;
      }
      storedId = window.localStorage.getItem(CURRENT_CHAT_KEY) || "";
    } catch {
      // Storage unavailable: start with an empty conversation.
    }
    if (!storedId) return;
    loadAssistantChatAction(storedId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setChatId(result.chat.id);
        setMessages(result.chat.messages);
      } else {
        try {
          window.localStorage.removeItem(CURRENT_CHAT_KEY);
        } catch {
          // Best-effort; nothing to clean up if storage is unavailable.
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [initialPrompt]);

  // Same hydrate-once-then-persist pattern, kept in localStorage (not
  // sessionStorage) so the model/effort choice survives tabs.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(OPTIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (typeof parsed.model === "string") setModel(parsed.model);
        if (typeof parsed.effort === "string") setEffort(parsed.effort);
      }
    } catch {
      // Corrupt or unavailable storage: start with defaults.
    }
    setOptionsHydrated(true);
  }, []);

  useEffect(() => {
    if (!optionsHydrated) return;
    try {
      window.localStorage.setItem(OPTIONS_KEY, JSON.stringify({ model, effort }));
    } catch {
      // Storage full or unavailable; persistence is best-effort.
    }
  }, [model, effort, optionsHydrated]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // Same auto-grow pattern as the main input, applied to whichever message
  // (at most one) is currently in edit mode.
  useEffect(() => {
    const el = editTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editingText, editingIndex]);

  async function persistChat(id: string, nextMessages: ChatMessage[]) {
    const result = await saveAssistantChatAction(id, nextMessages);
    if (result.ok) setChats(result.chats);
    else setError(result.error || t("assistant.error"));
  }

  // Shared by a fresh send and an edit-resend: replaces `messages` with
  // `history` plus the new user turn, then runs the ask/reply flow. Returns
  // whether it actually sent, so callers know whether to clear their input.
  function sendQuestion(question: string, history: ChatMessage[]) {
    const trimmed = question.trim();
    if (!trimmed || pending) return false;
    const id = chatId ?? createChatId();
    if (!chatId) {
      setChatId(id);
      try {
        window.localStorage.setItem(CURRENT_CHAT_KEY, id);
      } catch {
        // Best-effort; nothing to clean up if storage is unavailable.
      }
    }
    const userTurn: ChatMessage[] = [...history, { role: "user", content: trimmed }];
    setMessages(userTurn);
    setError("");
    void persistChat(id, userTurn);
    // model is "" (auto) or "<engine>:<id>", built from the options this
    // component renders, so the prefix is always a known engine.
    const separator = model.indexOf(":");
    const parsedModel = separator > 0
      ? { engine: model.slice(0, separator) as "claude" | "codex", model: model.slice(separator + 1) }
      : {};
    startTransition(async () => {
      const result = await askAssistantAction(history, trimmed, { ...parsedModel, effort: effort || undefined });
      if (!result.ok) {
        const message = result.error === "chat generation failed" ? t("assistant.errorTimeout") : result.error || t("assistant.error");
        setError(message);
        return;
      }
      const finalTurn: ChatMessage[] = [...userTurn, { role: "assistant", content: result.reply }];
      setMessages(finalTurn);
      await persistChat(id, finalTurn);
    });
    return true;
  }

  function handleSend() {
    if (sendQuestion(input, messages)) setInput("");
  }

  function resetConversation() {
    setChatId(null);
    setMessages([]);
    setError("");
    setEditingIndex(null);
    setEditingText("");
    setHistoryOpen(false);
    try {
      window.localStorage.removeItem(CURRENT_CHAT_KEY);
    } catch {
      // Best-effort; nothing to clean up if storage is unavailable.
    }
  }

  async function openChat(id: string) {
    const result = await loadAssistantChatAction(id);
    if (!result.ok) {
      setError(result.error || t("assistant.error"));
      return;
    }
    setChatId(result.chat.id);
    setMessages(result.chat.messages);
    setError("");
    setEditingIndex(null);
    setEditingText("");
    setHistoryOpen(false);
    try {
      window.localStorage.setItem(CURRENT_CHAT_KEY, result.chat.id);
    } catch {
      // Best-effort; nothing to clean up if storage is unavailable.
    }
  }

  async function deleteChat(id: string) {
    const result = await deleteAssistantChatAction(id);
    if (!result.ok) {
      setError(result.error || t("assistant.error"));
      return;
    }
    setChats(result.chats);
    if (id === chatId) resetConversation();
  }

  function startEdit(index: number, content: string) {
    setEditingIndex(index);
    setEditingText(content);
  }

  function cancelEdit() {
    setEditingIndex(null);
    setEditingText("");
  }

  // Everything from the edited message onward is discarded and regenerated,
  // exactly like ChatGPT's edit-and-resend.
  function confirmEdit() {
    if (editingIndex === null) return;
    if (sendQuestion(editingText, messages.slice(0, editingIndex))) {
      setEditingIndex(null);
      setEditingText("");
    }
  }

  return (
    <section className="assistant-card">
      <div className="assistant-card-head">
        <div className="assistant-options">
          {hasModelChoice ? (
            <label className="assistant-option">
              <span>{t("assistant.model")}</span>
              <CustomSelect name="assistant-model" options={modelOptions} value={model} onChange={handleModelChange} />
            </label>
          ) : null}
          <label className="assistant-option">
            <span>{t("assistant.effort")}</span>
            <CustomSelect name="assistant-effort" options={effortOptions} value={effort} onChange={setEffort} />
          </label>
        </div>
        <div className="assistant-head-actions">
          <button type="button" className="icon-button assistant-new" onClick={resetConversation} title={t("assistant.newChat")} aria-label={t("assistant.newChat")}>
            <Plus size={15} />
          </button>
          <button
            type="button"
            className="icon-button assistant-history-toggle"
            onClick={() => setHistoryOpen((open) => !open)}
            title={t("assistant.history")}
            aria-label={t("assistant.history")}
          >
            <History size={15} />
          </button>
        </div>
      </div>

      <div className="assistant-body">
        <aside className={`assistant-history${historyOpen ? " is-open" : ""}`} aria-label={t("assistant.history")}>
          <p className="assistant-history-title">{t("assistant.history")}</p>
          {chats.length === 0 ? (
            <p className="assistant-history-empty">{t("assistant.noHistory")}</p>
          ) : (
            chats.map((chat) => (
              <div key={chat.id} className="assistant-history-item-row">
                <button type="button" className="assistant-history-item" onClick={() => openChat(chat.id)}>
                  <span className="assistant-history-item-title">{chat.title}</span>
                  <span className="assistant-history-item-meta">
                    {new Date(chat.updatedAt).toLocaleString(locale)} · {chat.messageCount}
                  </span>
                </button>
                <button
                  type="button"
                  className="assistant-history-delete"
                  onClick={() => deleteChat(chat.id)}
                  aria-label={t("assistant.deleteChat")}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </aside>

        <div className="assistant-chat-pane">
          <div className="assistant-messages" role="log" aria-live="polite">
            {messages.length === 0 ? <p className="assistant-empty">{t("assistant.empty")}</p> : null}
            {messages.map((message, index) =>
              message.role === "user" ? (
                editingIndex === index ? (
                  <div key={index} className="assistant-edit-row">
                    <textarea
                      ref={editTextareaRef}
                      className="assistant-edit-textarea"
                      value={editingText}
                      onChange={(event) => setEditingText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          confirmEdit();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          cancelEdit();
                        }
                      }}
                      autoFocus
                      rows={1}
                    />
                    <div className="assistant-edit-actions">
                      <button type="button" className="assistant-edit-cancel" onClick={cancelEdit} disabled={pending}>
                        {t("assistant.editCancel")}
                      </button>
                      <button type="button" className="assistant-edit-send" onClick={confirmEdit} disabled={pending || !editingText.trim()}>
                        {t("assistant.editSend")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={index} className="assistant-bubble-user-wrap">
                    <p className="assistant-bubble assistant-bubble-user">{message.content}</p>
                    <button
                      type="button"
                      className="assistant-edit-button"
                      onClick={() => startEdit(index, message.content)}
                      disabled={pending}
                      aria-label={t("assistant.edit")}
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                )
              ) : (
                <div key={index} className="assistant-bubble assistant-bubble-assistant">
                  <MarkdownView content={message.content} />
                </div>
              )
            )}
            {pending ? <p className="assistant-bubble assistant-bubble-assistant assistant-thinking">{t("assistant.thinking")}</p> : null}
            {error ? <p className="assistant-error" role="alert">{error}</p> : null}
            <div ref={bottomRef} />
          </div>

          <form
            className="assistant-input-row"
            onSubmit={(event) => {
              event.preventDefault();
              handleSend();
            }}
          >
            <div className="assistant-input-wrap">
              <textarea
                ref={textareaRef}
                className="assistant-textarea"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={t("assistant.placeholder")}
                aria-label={t("assistant.placeholder")}
                maxLength={MAX_INPUT_LENGTH}
                rows={1}
              />
              <button type="submit" className="assistant-send" disabled={pending || !input.trim()} aria-label={t("assistant.send")}>
                <span className="assistant-send-circle"><ArrowUp size={18} /></span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
