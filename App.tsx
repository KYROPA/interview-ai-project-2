
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Settings, Mic, MicOff, Maximize, Minimize, Ghost, Trash2, Sparkles, BookOpen } from 'lucide-react';
import { AppMode, Hint } from './types';
import { DEFAULT_SYSTEM_INSTRUCTION, LIVE_MODEL } from './constants';
import { createBlob } from './services/audioUtils';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.DASHBOARD);
  const [isActive, setIsActive] = useState(false);
  const [currentHint, setCurrentHint] = useState<string>('');
  const [hints, setHints] = useState<Hint[]>([]); // Keep history for dashboard
  const [systemInstruction, setSystemInstruction] = useState(DEFAULT_SYSTEM_INSTRUCTION);
  const [lastTranscript, setLastTranscript] = useState('');

  const audioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const streamingTextRef = useRef<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      stopSession();
    };
  }, []);

  // Auto-scroll to bottom when new text arrives, unless user has scrolled up
  useEffect(() => {
    if (scrollRef.current) {
      const { scrollHeight, clientHeight, scrollTop } = scrollRef.current;
      const isAtBottom = scrollHeight - clientHeight <= scrollTop + 100;
      if (isAtBottom) {
        scrollRef.current.scrollTo({ top: scrollHeight, behavior: 'smooth' });
      }
    }
  }, [currentHint]);

  const startSession = async () => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });

      const sessionPromise = ai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: systemInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            console.log('Gemini Ghost observing...');
            setIsActive(true);
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              setLastTranscript(message.serverContent.inputTranscription.text);
            }
            
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              streamingTextRef.current += text;
              setCurrentHint(streamingTextRef.current);
            }

            if (message.serverContent?.turnComplete) {
              if (streamingTextRef.current.trim()) {
                const completedText = streamingTextRef.current.trim();
                const newHint: Hint = {
                  id: Math.random().toString(36).substring(7),
                  text: completedText,
                  timestamp: Date.now(),
                  type: 'hint'
                };
                setHints(prev => [newHint, ...prev].slice(0, 50));
              }
              streamingTextRef.current = '';
            }
          },
          onerror: (e) => {
            console.error('Gemini error:', e);
            stopSession();
          },
          onclose: () => {
            setIsActive(false);
          }
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error('Failed to start session:', err);
      alert('Could not access microphone or connect to Gemini API.');
    }
  };

  const stopSession = () => {
    setIsActive(false);
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    sessionRef.current = null;
    streamingTextRef.current = '';
  };

  const toggleSession = () => {
    if (isActive) stopSession();
    else startSession();
  };

  return (
    <div className={`min-h-screen transition-all duration-700 ${mode === AppMode.OVERLAY ? 'bg-transparent' : 'bg-[#0f172a] text-slate-100 font-sans'}`}>
      
      {mode === AppMode.DASHBOARD && (
        <div className="max-w-6xl mx-auto p-8 flex flex-col gap-8">
          <header className="flex justify-between items-center border-b border-slate-800 pb-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl shadow-2xl shadow-indigo-500/20 ring-1 ring-white/10">
                <Ghost className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                  Ghost <span className="text-indigo-400">Knowledge</span>
                </h1>
                <p className="text-slate-500 text-sm font-medium">Silent Deep Assistant • Live API</p>
              </div>
            </div>
            <button 
              onClick={() => setMode(AppMode.OVERLAY)}
              className="group flex items-center gap-2 px-6 py-3 bg-slate-800/50 hover:bg-slate-700 rounded-2xl border border-slate-700/50 transition-all hover:scale-105 active:scale-95"
            >
              <Maximize className="w-4 h-4 text-indigo-400 group-hover:scale-110 transition-transform" />
              <span className="font-semibold">Enter Overlay</span>
            </button>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Sidebar Controls */}
            <div className="lg:col-span-4 space-y-8">
              <div className="bg-slate-800/40 backdrop-blur-xl rounded-3xl p-6 border border-slate-700/50 shadow-2xl">
                <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
                  <Settings className="w-5 h-5 text-indigo-400" /> Active Session
                </h2>
                <button
                  onClick={toggleSession}
                  className={`w-full py-5 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all ${
                    isActive 
                      ? 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 shadow-lg shadow-red-500/5' 
                      : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-xl shadow-indigo-600/20'
                  }`}
                >
                  {isActive ? <MicOff className="w-6 h-6 animate-pulse" /> : <Mic className="w-6 h-6" />}
                  {isActive ? 'Cease Observation' : 'Initiate Listening'}
                </button>
                
                <div className="mt-8 pt-8 border-t border-slate-700/50">
                   <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Pulse Status</span>
                    <span className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-tighter ${isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>
                      {isActive ? 'Transmitting' : 'Idle'}
                    </span>
                  </div>
                  {lastTranscript && (
                    <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-700/50">
                      <p className="text-[10px] text-indigo-400/70 uppercase font-black mb-2 tracking-widest flex items-center gap-2">
                        <Sparkles className="w-3 h-3" /> Audio Feed
                      </p>
                      <p className="text-sm italic text-slate-300 leading-relaxed font-medium">"{lastTranscript}"</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-slate-800/40 backdrop-blur-xl rounded-3xl p-6 border border-slate-700/50 shadow-2xl">
                <h2 className="text-lg font-bold mb-4">Spirit Instruction</h2>
                <textarea 
                  value={systemInstruction}
                  onChange={(e) => setSystemInstruction(e.target.value)}
                  className="w-full h-48 bg-slate-900/80 border border-slate-700/50 rounded-2xl p-4 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none text-slate-300"
                />
              </div>
            </div>

            {/* Main Detailed View */}
            <div className="lg:col-span-8 flex flex-col gap-8">
              <div className="bg-slate-800/40 backdrop-blur-xl rounded-[2.5rem] p-8 border border-slate-700/50 shadow-2xl min-h-[500px] flex flex-col relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                    <BookOpen className="w-32 h-32 text-indigo-400" />
                </div>
                
                <div className="flex justify-between items-center mb-8 relative z-10">
                  <h2 className="text-xl font-black tracking-tight flex items-center gap-3">
                    <Sparkles className="w-5 h-5 text-indigo-400" /> 
                    Detailed Intelligence
                  </h2>
                  <div className="flex items-center gap-2">
                     <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mr-2">Scrollable View</span>
                  </div>
                </div>

                <div 
                  ref={scrollRef}
                  className="flex-grow overflow-y-auto max-h-[450px] pr-4 custom-scrollbar relative z-10"
                >
                  {currentHint ? (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 text-left">
                      <p className="text-2xl font-medium text-slate-100 leading-relaxed whitespace-pre-wrap selection:bg-indigo-500/30">
                        {currentHint}
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center py-20 opacity-30 select-none h-full">
                      <Ghost className="w-20 h-20 mb-6 text-slate-500 animate-pulse" />
                      <p className="text-xl font-bold tracking-tight text-slate-400">Silent Observation Active</p>
                    </div>
                  )}
                </div>
              </div>

              {/* History Shelf */}
              <div className="bg-slate-800/20 rounded-3xl p-6 border border-slate-800 shadow-xl">
                 <div className="flex justify-between items-center mb-6">
                    <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Chronicle</h3>
                    <button onClick={() => setHints([])} className="p-2 hover:bg-red-500/10 rounded-xl transition-colors text-slate-500 hover:text-red-400">
                      <Trash2 className="w-4 h-4" />
                    </button>
                 </div>
                 <div className="space-y-4 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                    {hints.map((hint, idx) => (
                       <div key={hint.id} className="p-4 bg-slate-900/40 rounded-xl border border-slate-800/50 hover:border-indigo-500/30 transition-all cursor-pointer" onClick={() => setCurrentHint(hint.text)}>
                          <p className="text-sm text-slate-400 line-clamp-2">{hint.text}</p>
                          <p className="text-[9px] text-slate-600 mt-2 font-bold">{new Date(hint.timestamp).toLocaleTimeString()}</p>
                       </div>
                    ))}
                 </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Overlay View (Scrollable Detailed Window) */}
      {mode === AppMode.OVERLAY && (
        <div className="fixed inset-0 p-12 flex items-end justify-center pointer-events-none">
          <div className="w-full max-w-4xl pointer-events-auto flex flex-col gap-6 animate-in slide-in-from-bottom-8 duration-1000">
            
            <div className="flex justify-between items-center bg-[#0a0a0a]/60 backdrop-blur-2xl border border-white/10 rounded-3xl px-8 py-4 shadow-3xl">
              <div className="flex items-center gap-4">
                <div className={`w-3 h-3 rounded-full ${isActive ? 'bg-indigo-400 shadow-[0_0_15px_rgba(129,140,248,0.8)] animate-pulse' : 'bg-slate-600'}`}></div>
                <span className="text-sm font-black text-white/90 uppercase tracking-widest">Spectral Intel</span>
              </div>
              <div className="flex items-center gap-6">
                 {lastTranscript && (
                    <div className="hidden md:block px-4 py-1.5 bg-white/5 rounded-full border border-white/5">
                        <p className="text-[10px] text-white/40 italic font-medium truncate max-w-xs">Feed: {lastTranscript}</p>
                    </div>
                 )}
                <button 
                  onClick={() => setMode(AppMode.DASHBOARD)}
                  className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/10 transition-all"
                >
                  <Minimize className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="relative group">
               <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500/20 to-purple-600/20 rounded-[2.5rem] blur opacity-50 group-hover:opacity-100 transition duration-1000"></div>
               
               <div 
                  ref={scrollRef}
                  className="relative bg-[#050505]/80 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] p-10 shadow-3xl max-h-[60vh] min-h-[300px] overflow-y-auto custom-scrollbar flex items-start text-left"
               >
                  {currentHint ? (
                    <div className="w-full">
                      <p className="text-3xl font-semibold text-white/95 leading-snug tracking-tight drop-shadow-sm selection:bg-indigo-500/40 whitespace-pre-wrap">
                        {currentHint}
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-4 opacity-10 m-auto">
                      <Ghost className="w-24 h-24 text-white" />
                      <p className="text-2xl font-black uppercase tracking-[0.2em] text-white">Ghost Silent</p>
                    </div>
                  )}
               </div>
            </div>

            <div className="text-center">
                <p className="text-[10px] text-white/20 font-bold uppercase tracking-[0.5em] animate-pulse">Scroll to read more if needed</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
