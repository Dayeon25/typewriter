import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import { 
  Keyboard as KeyboardIcon, 
  Monitor, 
  Smartphone, 
  Copy, 
  Delete, 
  CornerDownLeft, 
  Space,
  RefreshCw,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as Hangul from 'hangul-js';

// --- Keypad Configuration ---
const KEYPAD_CONFIG = [
  { id: '1', label: 'ㅣ', ko: ['ㅣ'], en: ['a', 'b', 'c'], num: ['1'] },
  { id: '2', label: 'ㆍ', ko: ['ㆍ'], en: ['d', 'e', 'f'], num: ['2'] },
  { id: '3', label: 'ㅡ', ko: ['ㅡ'], en: ['g', 'h', 'i'], num: ['3'] },
  { id: '4', label: 'ㄱㅋ', ko: ['ㄱ', 'ㅋ', 'ㄲ'], en: ['j', 'k', 'l'], num: ['4'] },
  { id: '5', label: 'ㄴㄹ', ko: ['ㄴ', 'ㄹ'], en: ['m', 'n', 'o'], num: ['5'] },
  { id: '6', label: 'ㄷㅌ', ko: ['ㄷ', 'ㅌ', 'ㄸ'], en: ['p', 'q', 'r', 's'], num: ['6'] },
  { id: '7', label: 'ㅂㅍ', ko: ['ㅂ', 'ㅍ', 'ㅃ'], en: ['t', 'u', 'v'], num: ['7'] },
  { id: '8', label: 'ㅅㅎ', ko: ['ㅅ', 'ㅎ'], en: ['w', 'x', 'y', 'z'], num: ['8'] },
  { id: '9', label: 'ㅈㅊ', ko: ['ㅈ', 'ㅊ', 'ㅉ'], en: ['.', ',', '!', '?'], num: ['9'] },
  { id: '*', label: '한/영/123', ko: ['mode'], en: ['mode'], num: ['mode'] },
  { id: '0', label: 'ㅇㅁ', ko: ['ㅇ', 'ㅁ'], en: [' '], num: ['0'] },
  { id: '#', label: '삭제', ko: ['backspace'], en: ['backspace'], num: ['backspace'] },
];

type InputMode = 'ko' | 'en' | 'num';

export default function App() {
  const [mode, setMode] = useState<'choice' | 'sender' | 'receiver'>('choice');
  const [inputMode, setInputMode] = useState<InputMode>('ko');
  const [roomId, setRoomId] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [text, setText] = useState('');
  const [composition, setComposition] = useState<string[]>([]);
  const [lastChar, setLastChar] = useState<string | null>(null);
  const [tapCount, setTapCount] = useState(0);
  const tapTimer = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Initialize Socket
  useEffect(() => {
    const socketUrl = window.location.origin;
    const newSocket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
    });

    newSocket.on('connect', () => {
      setIsConnected(true);
      console.log('Socket connected');
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
    });

    setSocket(newSocket);
    return () => {
      newSocket.close();
    };
  }, []);

  // Handle URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const m = params.get('mode');
    const r = params.get('room');
    if (m === 'sender' || m === 'receiver') setMode(m);
    if (r) setRoomId(r);
  }, []);

  // Join room
  useEffect(() => {
    if (socket && roomId) {
      socket.emit('join-room', roomId);
    }
  }, [socket, roomId]);

  // Receiver logic
  useEffect(() => {
    if (socket && mode === 'receiver') {
      socket.on('remote-keypress', (char: string) => {
        if (char === ' ') {
          setText(prev => prev + ' ');
          setComposition([]); 
          return;
        }
        
        const isKorean = /[ㄱ-ㅎㅏ-ㅣㆍ]/.test(char);
        
        if (isKorean) {
          setComposition(prev => {
            const next = [...prev, char];
            const processed = processCheonjiin(next);
            const assembled = Hangul.assemble(processed);
            setText(assembled);
            return next;
          });
        } else {
          setText(prev => prev + char);
          setComposition([]); 
        }
      });

      socket.on('remote-command', (cmd: string) => {
        if (cmd === 'backspace') {
          setComposition(prev => {
            if (prev.length > 0) {
              const next = prev.slice(0, -1);
              const processed = processCheonjiin(next);
              const assembled = Hangul.assemble(processed);
              setText(assembled);
              return next;
            } else {
              setText(prevText => prevText.slice(0, -1));
              return [];
            }
          });
        } else if (cmd === 'clear') {
          setComposition([]);
          setText('');
        }
      });
    }
    return () => {
      socket?.off('remote-keypress');
      socket?.off('remote-command');
    };
  }, [socket, mode, isConnected]);

  const processCheonjiin = (jamos: string[]) => {
    const result: string[] = [];
    let i = 0;
    while (i < jamos.length) {
      const cur = jamos[i];
      // If it's a Cheonjiin vowel building block
      if (cur === 'ㅣ' || cur === 'ㆍ' || cur === 'ㅡ') {
        let seq = cur;
        let j = i + 1;
        // Collect consecutive vowel blocks
        while (j < jamos.length && (jamos[j] === 'ㅣ' || jamos[j] === 'ㆍ' || jamos[j] === 'ㅡ')) {
          seq += jamos[j];
          j++;
        }
        const mapped = mapVowel(seq);
        if (Array.isArray(mapped)) {
          result.push(...mapped);
        } else {
          result.push(mapped);
        }
        i = j;
      } else {
        result.push(cur);
        i++;
      }
    }
    return result;
  };

  const mapVowel = (seq: string): string | string[] => {
    const table: Record<string, string> = {
      'ㆍㅣ': 'ㅏ',
      'ㆍㆍㅣ': 'ㅑ',
      'ㅣㆍ': 'ㅓ',
      'ㅣㆍㆍ': 'ㅕ',
      'ㆍㅡ': 'ㅗ',
      'ㆍㆍㅡ': 'ㅛ',
      'ㅡㆍ': 'ㅜ',
      'ㅡㆍㆍ': 'ㅠ',
      'ㅡㅣ': 'ㅢ',
      'ㆍㅣㅣ': 'ㅐ',
      'ㆍㆍㅣㅣ': 'ㅒ',
      'ㅣㆍㅣ': 'ㅔ',
      'ㅣㆍㆍㅣ': 'ㅖ',
      'ㆍㅡㅣ': 'ㅚ',
      'ㅡㆍㅣ': 'ㅟ',
      'ㆍㅡㆍㅣ': 'ㅘ',
      'ㆍㅡㆍㅣㅣ': 'ㅙ',
      'ㅡㆍㅣㆍㅣ': 'ㅝ',
      'ㅡㆍㅣㆍㅣㅣ': 'ㅞ',
      'ㅣ': 'ㅣ',
      'ㆍ': 'ㅏ', // Default single dot to ㅏ for assembly
      'ㅡ': 'ㅡ'
    };
    
    // Try to find the longest match from the start
    for (let len = seq.length; len > 0; len--) {
      const sub = seq.substring(0, len);
      if (table[sub]) {
        const remaining = seq.substring(len);
        if (remaining) {
          const nextMapped = mapVowel(remaining);
          return Array.isArray(nextMapped) ? [table[sub], ...nextMapped] : [table[sub], nextMapped];
        }
        return table[sub];
      }
    }
    return seq.split('');
  };

  const handleKeyClick = (keyId: string) => {
    if (!socket || !roomId) return;

    const config = KEYPAD_CONFIG.find(k => k.id === keyId);
    if (!config) return;

    const chars = config[inputMode];

    if (chars[0] === 'mode') {
      const modes: InputMode[] = ['ko', 'en', 'num'];
      const nextMode = modes[(modes.indexOf(inputMode) + 1) % modes.length];
      setInputMode(nextMode);
      setLastChar(null);
      setTapCount(0);
      return;
    }

    if (chars[0] === 'backspace') {
      socket.emit('command', { roomId, cmd: 'backspace' });
      setLastChar(null);
      setTapCount(0);
      return;
    }

    const isVowel = inputMode === 'ko' && ['1', '2', '3'].includes(keyId);

    if (lastChar === keyId && !isVowel && inputMode !== 'num') {
      // Multi-tap
      socket.emit('command', { roomId, cmd: 'backspace' });
      const nextTap = (tapCount + 1) % chars.length;
      setTapCount(nextTap);
      socket.emit('keypress', { roomId, char: chars[nextTap] });
      
      if (tapTimer.current) clearTimeout(tapTimer.current);
      tapTimer.current = setTimeout(() => {
        setLastChar(null);
        setTapCount(0);
      }, 800);
    } else {
      // New key
      if (tapTimer.current) clearTimeout(tapTimer.current);
      setLastChar(keyId);
      setTapCount(0);
      socket.emit('keypress', { roomId, char: chars[0] });
      
      if (!isVowel && inputMode !== 'num') {
        tapTimer.current = setTimeout(() => {
          setLastChar(null);
        }, 800);
      } else {
        setLastChar(null);
      }
    }
  };

  const generateRoom = () => {
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomId(id);
    setMode('receiver');
    window.history.pushState({}, '', `?mode=receiver&room=${id}`);
  };

  const sendCommand = (cmd: string) => {
    socket?.emit('command', { roomId, cmd });
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(text);
  };

  if (mode === 'choice') {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex flex-col items-center justify-center p-6 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white border border-[#141414] p-8 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]"
        >
          <h1 className="text-3xl font-bold mb-2 tracking-tight text-[#141414]">천지인 리모트</h1>
          <p className="text-sm text-gray-600 mb-8 italic font-serif">Cheonjiin Remote Keyboard</p>
          
          <div className="grid gap-4">
            <button 
              onClick={generateRoom}
              className="flex items-center justify-between p-4 border border-[#141414] hover:bg-[#141414] hover:text-white transition-colors group"
            >
              <div className="flex items-center gap-3">
                <Monitor className="w-6 h-6" />
                <span className="font-medium">컴퓨터에서 사용하기</span>
              </div>
              <span className="text-xs opacity-50 group-hover:opacity-100">RECEIVER</span>
            </button>
            
            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-[#141414]/20"></span></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-gray-400">OR</span></div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest opacity-50">방 코드 입력</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder="CODE"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  className="flex-1 p-3 border border-[#141414] font-mono focus:outline-none focus:ring-2 focus:ring-[#141414]"
                />
                <button 
                  onClick={() => {
                    if (roomId) {
                      setMode('sender');
                      window.history.pushState({}, '', `?mode=sender&room=${roomId}`);
                    }
                  }}
                  className="p-3 bg-[#141414] text-white hover:bg-gray-800 transition-colors"
                >
                  <Smartphone className="w-6 h-6" />
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  if (mode === 'receiver') {
    const shareUrl = `${window.location.origin}?mode=sender&room=${roomId}`;
    const serverUrl = process.env.APP_URL || window.location.origin;
    const pythonScript = `
import socketio
import pyautogui
import time

sio = socketio.Client()

@sio.on('remote-keypress')
def on_keypress(char):
    print(f"Typing: {char}")
    pyautogui.write(char)

@sio.on('remote-command')
def on_command(cmd):
    print(f"Command: {cmd}")
    if cmd == 'backspace':
        pyautogui.press('backspace')
    elif cmd == 'space':
        pyautogui.press('space')
    elif cmd == 'enter':
        pyautogui.press('enter')

@sio.event
def connect():
    print("Connected to server!")
    sio.emit('join-room', '${roomId}')

@sio.event
def disconnect():
    print("Disconnected from server")

try:
    print(f"Connecting to: ${serverUrl}")
    sio.connect('${serverUrl}')
    sio.wait()
except Exception as e:
    print(f"Error: {e}")
`.trim();

    return (
      <div className="min-h-screen bg-[#E4E3E0] p-4 md:p-12 font-sans">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Main Display */}
          <div className="lg:col-span-8 space-y-6">
            <div className="bg-white border border-[#141414] p-6 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                  <span className="text-xs font-mono font-bold uppercase tracking-widest">
                    {isConnected ? `Live Session: ${roomId}` : 'Disconnected'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => {
                      socket?.emit('keypress', { roomId, char: '!' });
                      setTimeout(() => socket?.emit('command', { roomId, cmd: 'backspace' }), 500);
                    }}
                    className="px-2 py-1 border border-[#141414]/20 text-[10px] uppercase font-bold hover:bg-gray-100 transition-colors"
                  >
                    Test Connection
                  </button>
                  <button onClick={() => sendCommand('clear')} className="p-2 hover:bg-gray-100 rounded transition-colors" title="Clear">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button onClick={copyToClipboard} className="p-2 hover:bg-gray-100 rounded transition-colors" title="Copy">
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <textarea 
                value={text}
                readOnly
                placeholder="핸드폰에서 타이핑을 시작하세요..."
                className="w-full h-[300px] p-6 text-2xl font-medium bg-gray-50 border border-dashed border-[#141414]/20 focus:outline-none resize-none leading-relaxed"
              />
            </div>

            {/* Desktop Integration Section */}
            <div className="bg-[#141414] text-white p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,0.2)]">
              <div className="flex items-center gap-3 mb-6">
                <Monitor className="w-6 h-6 text-blue-400" />
                <h2 className="text-xl font-bold tracking-tight">다른 창에 직접 입력하기 (데스크탑 모드)</h2>
              </div>
              
              <div className="grid md:grid-cols-2 gap-8">
                <div className="space-y-4 text-sm text-gray-400 font-serif italic">
                  <p>브라우저 밖(메모장, 카톡 등)에 직접 입력하려면 아래 파이썬 스크립트를 PC에서 실행하세요.</p>
                  <ol className="list-decimal list-inside space-y-2">
                    <li>Python 설치 후 터미널에서 실행:<br/>
                      <code className="bg-white/10 text-blue-300 px-2 py-1 rounded mt-1 inline-block not-italic font-mono text-[10px]">
                        pip install pyautogui python-socketio[client]
                      </code>
                    </li>
                    <li>오른쪽 코드를 <code className="text-white">helper.py</code>로 저장하고 실행합니다.</li>
                    <li>이제 핸드폰으로 치는 내용이 현재 포커스된 창에 입력됩니다!</li>
                  </ol>
                </div>
                
                <div className="relative">
                  <pre className="bg-black/50 p-4 rounded text-[10px] font-mono overflow-x-auto max-h-[200px] border border-white/10">
                    {pythonScript}
                  </pre>
                  <button 
                    onClick={() => navigator.clipboard.writeText(pythonScript)}
                    className="absolute top-2 right-2 p-2 bg-white/10 hover:bg-white/20 rounded text-xs transition-colors"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white border border-[#141414] p-6 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] flex flex-col items-center text-center">
              <h3 className="text-sm font-bold uppercase tracking-widest mb-6">핸드폰으로 연결</h3>
              <div className="bg-white p-4 border border-[#141414] mb-6">
                <QRCodeSVG value={shareUrl} size={180} />
              </div>
              <p className="text-xs text-gray-600 mb-4">카메라로 QR 코드를 스캔하세요</p>
              <div className="w-full p-2 bg-gray-100 text-[10px] font-mono break-all border border-[#141414]/10">
                {shareUrl}
              </div>
            </div>

            <div className="bg-white border border-[#141414] p-6 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]">
              <h3 className="text-xs font-bold uppercase tracking-widest mb-4 opacity-50">도움말</h3>
              <div className="space-y-4 text-xs text-gray-600">
                <div className="flex items-start gap-2">
                  <div className="w-4 h-4 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">1</div>
                  <p>핸드폰 자판은 0.7초 후 자동으로 글자가 완성됩니다.</p>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-4 h-4 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">2</div>
                  <p>모음(ㅣ, ㆍ, ㅡ)은 여러 번 눌러 조합할 수 있습니다.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Sender (Mobile Keyboard)
  return (
    <div className="fixed inset-0 bg-[#151619] flex flex-col font-mono text-white overflow-hidden select-none touch-none">
      {/* Header */}
      <div className="p-4 border-bottom border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <Smartphone className="w-4 h-4 text-gray-500" />
          <span className="text-[10px] uppercase tracking-widest text-gray-500">
            {isConnected ? `Connected: ${roomId}` : 'Connecting...'}
          </span>
        </div>
        <button 
          onClick={() => setMode('choice')}
          className="text-[10px] uppercase tracking-widest text-gray-500 hover:text-white"
        >
          Exit
        </button>
      </div>

      {/* Preview Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="text-center">
          <div className="text-4xl font-medium mb-2 min-h-[1.2em] text-blue-400">
            {lastChar ? KEYPAD_CONFIG.find(k => k.id === lastChar)?.[inputMode][tapCount] : ' '}
          </div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500">
            {inputMode === 'ko' ? '한글 입력' : inputMode === 'en' ? 'English' : 'Numbers'}
          </div>
        </div>
        
        <div className="mt-12 flex gap-4">
          <button 
            onClick={() => sendCommand('clear')}
            className="px-4 py-2 border border-red-500/30 text-red-400 text-[10px] uppercase tracking-widest rounded-full hover:bg-red-500/10 transition-colors"
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Cheonjiin Keyboard */}
      <div className="bg-[#1c1d21] p-2 pb-8 grid grid-cols-3 gap-2">
        {KEYPAD_CONFIG.map((key) => (
          <motion.button
            key={key.id}
            whileTap={{ scale: 0.95, backgroundColor: '#2a2b30' }}
            onClick={() => handleKeyClick(key.id)}
            className={`h-20 rounded-xl flex flex-col items-center justify-center border border-white/5 shadow-lg ${
              key.id === '*' ? 'bg-blue-900/40 border-blue-500/30' : 'bg-[#232429]'
            }`}
          >
            <span className="text-2xl font-bold">{key.id}</span>
            <span className="text-[10px] text-gray-500 mt-1">{key.label}</span>
          </motion.button>
        ))}
      </div>

      {/* Bottom Bar */}
      <div className="h-1 w-24 bg-white/10 mx-auto mb-2 rounded-full"></div>
    </div>
  );
}
