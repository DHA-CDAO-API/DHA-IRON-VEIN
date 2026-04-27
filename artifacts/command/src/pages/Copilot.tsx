import React, { useState, useRef, useEffect } from 'react';
import { useListConversations, useCreateConversation, useGetConversation } from '@workspace/api-client-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Bot, User, Send, Plus, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

export default function Copilot() {
  const queryClient = useQueryClient();
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [provider, setProvider] = useState('openai');
  const [streamingMessage, setStreamingMessage] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: convos, isLoading: convosLoading } = useListConversations();
  const { data: activeDetail, isLoading: detailLoading } = useGetConversation(activeConvId || '', {
    query: { enabled: !!activeConvId }
  });
  
  const createConv = useCreateConversation();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeDetail?.messages, streamingMessage]);

  const handleCreate = () => {
    createConv.mutate({ data: { title: 'New Analysis' } }, {
      onSuccess: (res) => setActiveConvId(res.id)
    });
  };

  const handleSend = async () => {
    if (!input.trim() || !activeConvId || isStreaming) return;
    
    const userMsg = input.trim();
    setInput('');
    setIsStreaming(true);
    setStreamingMessage('');
    
    // Optimistically add user message to cache
    if (activeDetail) {
      queryClient.setQueryData(['/api/copilot/conversations', activeConvId], {
        ...activeDetail,
        messages: [...activeDetail.messages, { id: Date.now().toString(), role: 'user', content: userMsg, createdAt: new Date().toISOString() }]
      });
    }

    try {
      const res = await fetch(`/api/copilot/conversations/${activeConvId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: userMsg, provider })
      });

      if (!res.ok || !res.body) throw new Error('Stream failed');

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
                  setStreamingMessage(prev => prev + data.value);
                }
              } catch (e) {}
            }
          }
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsStreaming(false);
      queryClient.invalidateQueries({ queryKey: ['/api/copilot/conversations', activeConvId] });
      setStreamingMessage('');
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
          <div className="font-bold tracking-wide">Copilot</div>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="Select Provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI (gpt-5.4)</SelectItem>
              <SelectItem value="anthropic">Anthropic (claude-sonnet)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6" ref={scrollRef}>
          {!activeConvId ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-4">
              <Bot className="h-12 w-12 text-primary/30" />
              <p>Select or create a conversation to start</p>
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
              
              {isStreaming && (
                <div className="flex gap-4 max-w-4xl mx-auto">
                  <div className="h-8 w-8 rounded-full shrink-0 flex items-center justify-center bg-primary/20 text-primary">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div className="flex flex-col gap-1 items-start">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">assistant</div>
                    <div className="p-4 rounded-lg text-sm whitespace-pre-wrap bg-card border border-border/50 min-w-[60px]">
                      {streamingMessage}
                      <span className="inline-block w-2 h-4 ml-1 bg-primary animate-pulse align-middle"></span>
                    </div>
                  </div>
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
              <Button size="icon" className="absolute bottom-2 right-2 h-8 w-8" onClick={handleSend} disabled={!input.trim() || !activeConvId || isStreaming}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
