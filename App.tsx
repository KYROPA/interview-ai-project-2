import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Settings, Mic, MicOff, Maximize, Minimize, Ghost, Trash2, Sparkles, BookOpen, AlertCircle, Loader2 } from 'lucide-react';
import { AppMode, Hint } from './types';
import { DEFAULT_SYSTEM_INSTRUCTION, LIVE_MODEL } from './constants';
import { createBlob } from './services/audioUtils';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.DASHBOARD);
  const [isActive, setIsActive] = useState(false);
  const [isError, setIsError] = useState<string | null>(null);
  const [currentHint, setCurrentHint] = useState<string>('');
  const [hints, setHints] = useState<Hint[]>([]);
  const [systemInstruction, setSystemInstruction] = useState(DEFAULT_SYSTEM_INSTRUCTION);
  const [lastTranscript, setLastTranscript] = useState('');
  const [volume, setVolume] = useState(0);
  const [isConnecting, setIsConnecting] = useState(false);

  const isActiveRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const sessionRef = useRef<any>(null);
  const streamingTextRef = useRef<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const retryCountRef = useRef(0);
  
  const VAD_THRESHOLD = 0.012; // Slightly lowered for better detection

  useEffect(() => {
    return () => {
      stopSession();
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      const { scrollHeight, clientHeight, scrollTop } = scrollRef.current;
      const isAtBottom = scrollHeight - clientHeight <= scrollTop + 150;
      if (isAtBottom) {
        scrollRef.current.scrollTo({ top: scrollHeight, behavior: 'smooth' });
      }
    }
  }, [currentHint]);

  const startSession = async () => {
    if (isActiveRef.current || isConnecting) return;
    
    setIsError(null);
    setIsConnecting(true);
    
    try {
      const apiKey = process.env.API_KEY;
      if (!apiKey) {
        throw new Error('API Key is missing in environment.');
      }

      const ai = new GoogleGenAI({ apiKey });
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;

      const sessionPromise = ai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }
          },
          systemInstruction: systemInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            console.log('Gemini Ghost connection established.');
            setIsActive(true);
            isActiveRef.current = true;
            setIsConnecting(false);
            retryCountRef.current = 0;

            const source = audioCtx.createMediaStreamSource(stream);
            const scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1);
            
            sourceRef.current = source;
            processorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
              // Use Ref to check the latest state regardless of closure
              if (!isActiveRef.current) return;

              const inputData = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for (let i = 0; i < inputData.length; i++) {
                sum += inputData[i] * inputData[i];
              }
              const rms = Math.sqrt(sum / inputData.length);
              setVolume(rms);

              if (rms > VAD_THRESHOLD) {
                const pcmBlob = createBlob(inputData);
                sessionPromise.then((session) => {
                  if (isActiveRef.current && session) {
                    try {
                      session.sendRealtimeInput({ media: pcmBlob });
                    } catch (err) {
                      console.warn('Realtime input delivery failed:', err);
                    }
                  }
                }).catch(err => {
                  console.error('Session promise rejected:', err);
                });
              }
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(audioCtx.destination);
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
          onerror: (e: any) => {
            console.error('Gemini Live Error:', e);
            const errorMsg = e?.message || String(e);
            
            if (errorMsg.includes('429')) {
              handleRetry('Quota exceeded (429).');
            } else if (errorMsg.includes('403') || errorMsg.includes('401')) {
              setIsError('Invalid API Key or Permissions.');
              stopSession();
            } else {
              setIsError(`Connection error: ${errorMsg.slice(0, 50)}...`);
              stopSession();
            }
          },
          onclose: (e: CloseEvent) => {
            console.log('Gemini Ghost session closed:', e.reason || 'No reason provided');
            // If it closed unexpectedly (not by our stopSession)
            if (isActiveRef.current) {
               if (retryCountRef.current < 3) {
                  handleRetry('Connection lost.');
               } else {
                  setIsError('Session terminated by server. Check your internet or API limits.');
                  stopSession();
               }
            }
          }
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err: any) {
      console.error('Start session failed:', err);
      setIsError(err.message || 'Microphone or API access denied.');
      setIsConnecting(false);
      stopSession();
    }
  };

  const handleRetry = (reason: string) => {
    stopSession();
    const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 15000);
    retryCountRef.current += 1;
    setIsError(`${reason} Retrying in ${Math.round(delay/1000)}s...`);
    setTimeout(() => {
      if (!isActiveRef.current && retryCountRef.current > 0) {
        startSession();
      }
    }, delay);
  };

  const stopSession = () => {
    isActiveRef.current = false;
    setIsActive(false);
    setIsConnecting(false);
    
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
        processorRef.current.onaudioprocess = null;
      } catch(e) {}
      processorRef.current = null;
    }
    
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch(e) {}
      sourceRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch(e) {}
      sessionRef.current = null;
    }

    streamingTextRef.current = '';
    setVolume(0);
  };

  const toggleSession = () => {
    if (isActive || isConnecting) {
      retryCountRef.current = 0;
      stopSession();
    } else {
      startSession();
    }
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

          {isError && (
            <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl flex items-center gap-3 text-red-400 animate-in fade-in slide-in-from-top-2">
              <AlertCircle className="w-5 h-5" />
              <span className="text-sm font-medium">{isError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-4 space-y-8">
              <div className="bg-slate-800/40 backdrop-blur-xl rounded-3xl p-6 border border-slate-700/50 shadow-2xl">
                <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
                  <Settings className="w-5 h-5 text-indigo-400" /> Session Control
                </h2>
                <button
                  disabled={isConnecting}
                  onClick={toggleSession}
                  className={`w-full py-5 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all ${
                    isConnecting 
                      ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                      : isActive 
                        ? 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 shadow-lg shadow-red-500/5' 
                        : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-xl shadow-indigo-600/20'
                  }`}
                >
                  {isConnecting ? <Loader2 className="w-6 h-6 animate-spin" /> : isActive ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                  {isConnecting ? 'Materializing...' : isActive ? 'Cease Observation' : 'Initiate Listening'}
                </button>
                
                <div className="mt-8 pt-8 border-t border-slate-700/50">
                   <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Mic Activity (VAD)</span>
                    <span className={`text-[10px] font-black uppercase ${volume > VAD_THRESHOLD ? 'text-emerald-400' : 'text-slate-600'}`}>
                      {volume > VAD_THRESHOLD ? 'Transmitting' : 'Filtering Silence'}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden mb-4">
                    <div 
                      className={`h-full transition-all duration-100 ${volume > VAD_THRESHOLD ? 'bg-indigo-500' : 'bg-slate-700'}`} 
                      style={{ width: `${Math.min(volume * 1200, 100)}%` }}
                    />
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

            <div className="lg:col-span-8 flex flex-col gap-8">
              <div className="bg-slate-800/40 backdrop-blur-xl rounded-[2.5rem] p-8 border border-slate-700/50 shadow-2xl min-h-[500px] flex flex-col relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                    <BookOpen className="w-32 h-32 text-indigo-400" />
                </div>
                
                <div className="flex justify-between items-center mb-8 relative z-10">
                  <h2 className="text-xl font-black tracking-tight flex items-center gap-3">
                    <Sparkles className="w-5 h-5 text-indigo-400" /> 
                    Intelligence Output
                  </h2>
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
                      <p className="text-xl font-bold tracking-tight text-slate-400">Ready to Observe</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-slate-800/20 rounded-3xl p-6 border border-slate-800 shadow-xl">
                 <div className="flex justify-between items-center mb-6">
                    <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Chronicle</h3>
                    <button onClick={() => setHints([])} className="p-2 hover:bg-red-500/10 rounded-xl transition-colors text-slate-500 hover:text-red-400">
                      <Trash2 className="w-4 h-4" />
                    </button>
                 </div>
                 <div className="space-y-4 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                    {hints.length > 0 ? hints.map((hint) => (
                       <div key={hint.id} className="p-4 bg-slate-900/40 rounded-xl border border-slate-800/50 hover:border-indigo-500/30 transition-all cursor-pointer" onClick={() => setCurrentHint(hint.text)}>
                          <p className="text-sm text-slate-400 line-clamp-2">{hint.text}</p>
                          <p className="text-[9px] text-slate-600 mt-2 font-bold">{new Date(hint.timestamp).toLocaleTimeString()}</p>
                       </div>
                    )) : (
                      <p className="text-xs text-slate-600 italic">History is empty...</p>
                    )}
                 </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {mode === AppMode.OVERLAY && (
        <div className="fixed inset-0 p-12 flex items-end justify-center pointer-events-none">
          <div className="w-full max-w-4xl pointer-events-auto flex flex-col gap-6 animate-in slide-in-from-bottom-8 duration-1000">
            
            <div className="flex justify-between items-center bg-[#0a0a0a]/60 backdrop-blur-2xl border border-white/10 rounded-3xl px-8 py-4 shadow-3xl">
              <div className="flex items-center gap-4">
                <div className={`w-3 h-3 rounded-full ${isActive ? 'bg-indigo-400 shadow-[0_0_15px_rgba(129,140,248,0.8)] animate-pulse' : 'bg-slate-600'}`}></div>
                <span className="text-sm font-black text-white/90 uppercase tracking-widest">Spectral Intel</span>
              </div>
              <div className="flex items-center gap-6">
                <button 
                  onClick={() => setMode(AppMode.DASHBOARD)}
                  className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/10 transition-all"
                >
                  <Minimize className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="relative group">
               <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500/20 to-purple-600/20 rounded-[2.5rem] blur opacity-50"></div>
               <div 
                  ref={scrollRef}
                  className="relative bg-[#050505]/80 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] p-10 shadow-3xl max-h-[60vh] min-h-[300px] overflow-y-auto custom-scrollbar flex items-start text-left"
               >
                  {currentHint ? (
                    <div className="w-full">
                      <p className="text-3xl font-semibold text-white/95 leading-snug tracking-tight drop-shadow-sm whitespace-pre-wrap">
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
          </div>
        </div>
      )}
    </div>
  );
};

export default App;