import React, { useState, useRef, useEffect } from 'react';
import { useListConversations, useCreateConversation, useGetConversation, getGetConversationQueryKey } from '@workspace/api-client-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Bot, User, Send, Plus, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { AiBadge } from '@/components/ui/ai-badge';

export default function Copilot() {
  const queryClient = useQueryClient();
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [provider, setProvider] = useState('openai');
  // All in-flight optimistic state is scoped to a conversation id.
  // If the operator switches sidebar chats while a send is mid-
  // stream, we want the pinned user bubble + "Thinking…" + any
  // error to STAY with the originating conversation, not bleed
  // into whichever chat is currently focused. Render-time guards
  // (`pending.convId === activeConvId`, etc.) enforce that.
  const [pending, setPending] = useState<{ convId: string; content: string } | null>(null);
  const [streaming, setStreaming] = useState<{ convId: string; text: string } | null>(null);
  const [lastError, setLastError] = useState<{ convId: string; message: string } | null>(null);
  const isStreaming = streaming !== null;
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: convos, isLoading: convosLoading } = useListConversations();
  const { data: activeDetail, isLoading: detailLoading } = useGetConversation(activeConvId || '', {
    query: { queryKey: getGetConversationQueryKey(activeConvId || ''), enabled: !!activeConvId },
  });

  const createConv = useCreateConversation();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeDetail?.messages, streaming?.text, pending?.content, activeConvId]);

  const handleCreate = (): Promise<string | null> => {
    return new Promise((resolve) => {
      createConv.mutate(
        { data: { title: 'New Analysis' } },
        {
          onSuccess: (res) => {
            setActiveConvId(res.id);
            resolve(res.id);
          },
          onError: (err) => {
            console.error('Failed to create conversation', err);
            resolve(null);
          },
        },
      );
    });
  };

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;
    const userMsg = input.trim();
    setLastError(null);
    setInput('');

    // Auto-create a conversation on first send so the user doesn't have
    // to click "New Chat" before they can ask anything. This was the
    // single biggest UX trap on this page — users would type, hit Enter,
    // and see nothing happen because the send button silently disabled
    // itself when there was no active conversation yet.
    let convId = activeConvId;
    if (!convId) {
      convId = await handleCreate();
      if (!convId) {
        setLastError({ convId: '', message: 'Could not start a new conversation. Please try again.' });
        return;
      }
    }

    // Pin the user message and start the streaming bubble, scoped to
    // the originating convId so switching sidebar chats mid-stream does
    // not bleed the pending bubble into a different conversation.
    setPending({ convId, content: userMsg });
    setStreaming({ convId, text: '' });

    try {
      // Streaming endpoint: we can't go through the OpenAPI client because
      // it consumes the body to JSON, so we hit fetch directly. That means
      // we have to mirror the CSRF double-submit token by hand — read the
      // `csrf` cookie and echo it as `X-CSRF-Token`, exactly like the
      // shared customFetch does for every other mutation. Without this
      // header the server's csrfMiddleware rejects the POST with 403
      // `csrf_token_invalid` and the operator just sees a generic
      // "Copilot request failed (HTTP 403)".
      const csrfCookie = (() => {
        if (typeof document === 'undefined') return null;
        for (const part of document.cookie.split(';')) {
          const trimmed = part.trim();
          if (trimmed.startsWith('csrf=')) {
            return decodeURIComponent(trimmed.slice('csrf='.length));
          }
        }
        return null;
      })();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfCookie) headers['X-CSRF-Token'] = csrfCookie;
      const res = await fetch(`/api/copilot/conversations/${convId}/messages`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ content: userMsg, provider })
      });

      if (!res.ok || !res.body) {
        throw new Error(`Copilot request failed (HTTP ${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'token') {
                  setStreaming(prev => (prev ? { ...prev, text: prev.text + data.value } : prev));
                } else if (data.type === 'error') {
                  setLastError({
                    convId,
                    message: typeof data.value === 'string' ? data.value : 'Copilot stream error',
                  });
                }
              } catch (e) {}
            }
          }
        }
      }
    } catch (e) {
      console.error(e);
      setLastError({ convId, message: (e as Error)?.message ?? 'Copilot request failed' });
    } finally {
      // Invalidate using the local `convId` (not `activeConvId`) — when
      // we just auto-created the conversation in this same tick, the
      // `activeConvId` closure value is still null because React hasn't
      // re-rendered yet. Combined with our app-wide staleTime: Infinity,
      // invalidating the wrong key would leave the freshly-streamed
      // assistant message stale on screen until a hard refresh.
      // Wait for the refetch to complete BEFORE clearing the optimistic
      // pending bubbles — otherwise there's a one-frame gap where the
      // user sees an empty chat between "streaming finished" and "server
      // messages loaded".
      try {
        await queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(convId) });
      } catch {
        /* invalidation failures are non-fatal */
      }
      setStreaming(null);
      setPending(null);
    }
  };

  const suggestions = [
    "Explain top alerts",
    "Why is BAS Steel red?",
    "Recommend orders for next 7 days",
    "Run a typhoon scenario"
  ];

  return (
    <div className="h-full flex p-4 gap-4 bg-background overflow-hidden">
      {/* Left Rail */}
      <div className="w-[280px] flex flex-col gap-4 shrink-0 bg-card/30 border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border/50 shrink-0">
          <Button className="w-full" onClick={handleCreate} disabled={createConv.isPending}>
            {createConv.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            New Chat
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {convosLoading ? (
            <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
          ) : convos?.map(c => (
            <button
              key={c.id}
              onClick={() => setActiveConvId(c.id)}
              className={`w-full text-left p-3 rounded-md text-sm transition-colors ${activeConvId === c.id ? 'bg-primary/20 text-primary font-medium' : 'hover:bg-muted text-muted-foreground'}`}
            >
              <div className="truncate">{c.title}</div>
              <div className="text-[10px] mt-1 opacity-70">{new Date(c.createdAt).toLocaleDateString()}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Main Chat */}
      <div className="flex-1 flex flex-col bg-card/30 border border-border rounded-xl overflow-hidden min-w-0">
        <div className="h-14 border-b border-border/50 flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="font-bold tracking-wide">Copilot</div>
            <AiBadge />
          </div>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="Select Provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI (gpt-5.4)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6" ref={scrollRef}>
          {/* Show the empty placeholder ONLY when there's no active
              chat AND nothing in flight. The instant the user hits
              Send (which queues both `pendingUserMsg` and
              `isStreaming` synchronously, before any await), the
              placeholder yields to the live conversation view —
              that's the difference between "I think it took my
              question" and what we had before, where the page
              looked frozen until the SSE stream completed. */}
          {!activeConvId && !pending && !isStreaming ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
              <Bot className="h-12 w-12 text-primary/30" />
              <p className="text-sm">Ask Copilot anything about the theater.</p>
              <p className="text-xs opacity-70">Type a question below — a new chat starts automatically.</p>
            </div>
          ) : (
            <>
              {activeDetail?.messages.map((m, i) => (
                <div key={i} className={`flex gap-4 max-w-4xl mx-auto ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`h-8 w-8 rounded-full shrink-0 flex items-center justify-center ${m.role === 'user' ? 'bg-secondary' : 'bg-primary/20 text-primary'}`}>
                    {m.role === 'user' ? <User className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
                  </div>
                  <div className={`flex flex-col gap-1 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">{m.role}</div>
                    <div className={`p-4 rounded-lg text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-secondary text-foreground' : 'bg-card border border-border/50'}`}>
                      {m.content}
                    </div>
                  </div>
                </div>
              ))}

              {/* Pinned in-flight user message. Suppressed once the
                  server-side copy of the same text shows up at the
                  tail of the conversation — without this guard we
                  briefly render two identical user bubbles whenever
                  the conversation refetch lands before the POST's
                  invalidate-and-clear cycle finishes (which happens
                  routinely because the POST inserts the user row
                  before it starts streaming the assistant tokens). */}
              {pending && pending.convId === activeConvId && !(
                activeDetail?.messages?.length &&
                activeDetail.messages[activeDetail.messages.length - 1]?.role === 'user' &&
                activeDetail.messages[activeDetail.messages.length - 1]?.content?.trim() === pending.content
              ) && (
                <div className="flex gap-4 max-w-4xl mx-auto flex-row-reverse">
                  <div className="h-8 w-8 rounded-full shrink-0 flex items-center justify-center bg-secondary">
                    <User className="h-5 w-5" />
                  </div>
                  <div className="flex flex-col gap-1 items-end">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">user</div>
                    <div className="p-4 rounded-lg text-sm whitespace-pre-wrap bg-secondary text-foreground">
                      {pending.content}
                    </div>
                  </div>
                </div>
              )}

              {streaming && streaming.convId === activeConvId && (
                <div className="flex gap-4 max-w-4xl mx-auto">
                  <div className="h-8 w-8 rounded-full shrink-0 flex items-center justify-center bg-primary/20 text-primary">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div className="flex flex-col gap-1 items-start">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">assistant</div>
                    <div className="p-4 rounded-lg text-sm whitespace-pre-wrap bg-card border border-border/50 min-w-[60px]">
                      {streaming.text || (
                        <span className="text-muted-foreground italic">Thinking…</span>
                      )}
                      <span className="inline-block w-2 h-4 ml-1 bg-primary animate-pulse align-middle"></span>
                    </div>
                  </div>
                </div>
              )}

              {lastError && lastError.convId === activeConvId && !isStreaming && (
                <div className="max-w-4xl mx-auto p-3 rounded-lg border border-destructive/40 bg-destructive/10 text-xs text-destructive">
                  {lastError.message}
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 bg-background border-t border-border shrink-0">
          <div className="max-w-4xl mx-auto">
            <div className="flex gap-2 mb-3 overflow-x-auto pb-2 scrollbar-none">
              {suggestions.map((s, i) => (
                <Badge key={i} variant="outline" className="shrink-0 cursor-pointer hover:bg-primary/20 text-xs font-normal border-primary/30" onClick={() => setInput(s)}>
                  {s}
                </Badge>
              ))}
            </div>
            <div className="relative">
              <Textarea 
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask Copilot about theater logistics..."
                className="resize-none pr-12 min-h-[60px] bg-card border-border/50 focus-visible:ring-primary/50"
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              {/* The send button no longer requires an existing
                  conversation — handleSend will auto-create one if
                  needed. Keeping !activeConvId here would mean
                  first-message clicks (vs. Enter) silently failed
                  because the button stayed disabled. */}
              <Button size="icon" className="absolute bottom-2 right-2 h-8 w-8" onClick={handleSend} disabled={!input.trim() || isStreaming}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
