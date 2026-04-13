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
  Info,
  MousePointer2,
  Type
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as Hangul from 'hangul-js';

// --- Keypad Configuration ---
const KEYPAD_CONFIG = [
  { id: '1', label: 'ㅣ', enLabel: 'abc', ko: ['ㅣ'], en: ['a', 'b', 'c'], num: ['1'] },
  { id: '2', label: 'ㆍ', enLabel: 'def', ko: ['ㆍ'], en: ['d', 'e', 'f'], num: ['2'] },
  { id: '3', label: 'ㅡ', enLabel: 'ghi', ko: ['ㅡ'], en: ['g', 'h', 'i'], num: ['3'] },
  { id: '4', label: 'ㄱㅋ', enLabel: 'jkl', ko: ['ㄱ', 'ㅋ', 'ㄲ'], en: ['j', 'k', 'l'], num: ['4'] },
  { id: '5', label: 'ㄴㄹ', enLabel: 'mno', ko: ['ㄴ', 'ㄹ'], en: ['m', 'n', 'o'], num: ['5'] },
  { id: '6', label: 'ㄷㅌ', enLabel: 'pqrs', ko: ['ㄷ', 'ㅌ', 'ㄸ'], en: ['p', 'q', 'r', 's'], num: ['6'] },
  { id: '7', label: 'ㅂㅍ', enLabel: 'tuv', ko: ['ㅂ', 'ㅍ', 'ㅃ'], en: ['t', 'u', 'v'], num: ['7'] },
  { id: '8', label: 'ㅅㅎ', enLabel: 'wxyz', ko: ['ㅅ', 'ㅎ'], en: ['w', 'x', 'y', 'z'], num: ['8'] },
  { id: '9', label: 'ㅈㅊ', enLabel: '.,!?', ko: ['ㅈ', 'ㅊ', 'ㅉ'], en: ['.', ',', '!', '?'], num: ['9'] },
  { id: '*', label: '한/영/123', enLabel: 'KO/EN/123', ko: ['mode'], en: ['mode'], num: ['mode'] },
  { id: '0', label: 'ㅇㅁ', enLabel: 'space', ko: ['ㅇ', 'ㅁ'], en: [' '], num: ['0'] },
  { id: '#', label: '삭제', enLabel: 'del', ko: ['backspace'], en: ['backspace'], num: ['backspace'] },
];

type InputMode = 'ko' | 'en' | 'num';
type MobileTab = 'keyboard' | 'mouse';

export default function App() {
  const [mode, setMode] = useState<'choice' | 'sender' | 'receiver'>('choice');
  const [inputMode, setInputMode] = useState<InputMode>('ko');
  const [activeTab, setActiveTab] = useState<MobileTab>('keyboard');
  const [roomId, setRoomId] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [text, setText] = useState('');
  const [composition, setComposition] = useState<string[]>([]);
  const [lastChar, setLastChar] = useState<string | null>(null);
  const [tapCount, setTapCount] = useState(0);
  const tapTimer = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  
  // Mouse state
  const mouseRef = useRef({ x: 0, y: 0 });

  const addLog = (msg: string) => {
    setDebugLog(prev => [new Date().toLocaleTimeString() + ': ' + msg, ...prev].slice(0, 5));
  };

  // Initialize Socket
  useEffect(() => {
    // Try APP_URL first, then current origin
    const socketUrl = (process.env.APP_URL || window.location.origin).replace(/\/$/, "");
    addLog(`Connecting to: ${socketUrl}`);
    
    const newSocket = io(socketUrl, {
      transports: ['websocket'], // Use websocket directly to avoid XHR polling issues
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      timeout: 20000,
    });

    newSocket.on('connect', () => {
      setIsConnected(true);
      setConnectionError(null);
      addLog('Connected successfully!');
    });

    newSocket.on('disconnect', (reason) => {
      setIsConnected(false);
      addLog(`Disconnected: ${reason}`);
    });

    newSocket.on('connect_error', (err) => {
      setConnectionError(err.message);
      addLog(`Connection error: ${err.message}`);
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
    if (socket?.connected && roomId) {
      socket.emit('join-room', roomId);
      addLog(`Joined room: ${roomId}`);
    }
  }, [socket, roomId, isConnected]);

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
            // If assembly fails or returns empty, show the raw jamos
            const assembled = Hangul.assemble(processed);
            setText(assembled || processed.join(''));
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
              setText(assembled || processed.join(''));
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

      socket.on('remote-mouse-move', ({ dx, dy }: { dx: number, dy: number }) => {
        console.log('Mouse move:', dx, dy);
      });
    }
    return () => {
      socket?.off('remote-keypress');
      socket?.off('remote-command');
      socket?.off('remote-mouse-move');
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
      'ㆍㅣ': 'ㅏ', 'ㆍㆍㅣ': 'ㅑ', 'ㅣㆍ': 'ㅓ', 'ㅣㆍㆍ': 'ㅕ',
      'ㆍㅡ': 'ㅗ', 'ㆍㆍㅡ': 'ㅛ', 'ㅡㆍ': 'ㅜ', 'ㅡㆍㆍ': 'ㅠ',
      'ㅡㅣ': 'ㅢ', 'ㆍㅣㅣ': 'ㅐ', 'ㆍㆍㅣㅣ': 'ㅒ', 'ㅣㆍㅣ': 'ㅔ',
      'ㅣㆍㆍㅣ': 'ㅖ', 'ㆍㅡㅣ': 'ㅚ', 'ㅡㆍㅣ': 'ㅟ', 'ㆍㅡㆍㅣ': 'ㅘ',
      'ㆍㅡㆍㅣㅣ': 'ㅙ', 'ㅡㆍㅣㆍㅣ': 'ㅝ', 'ㅡㆍㅣㆍㅣㅣ': 'ㅞ',
      'ㅣ': 'ㅣ', 'ㆍ': 'ㅏ', 'ㅡ': 'ㅡ'
    };
    // Special case for single building blocks to ensure they show up
    if (seq === 'ㆍ') return 'ㅏ'; 
    if (seq === 'ㅣ') return 'ㅣ';
    if (seq === 'ㅡ') return 'ㅡ';
    
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
    const serverUrl = window.location.origin;
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

@sio.on('remote-mouse-move')
def on_mouse_move(data):
    dx = data.get('dx', 0)
    dy = data.get('dy', 0)
    pyautogui.moveRel(dx * 2, dy * 2)

@sio.on('remote-mouse-click')
def on_mouse_click(data):
    button = data.get('button', 'left')
    pyautogui.click(button=button)

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
                  <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-500 animate-pulse'}`}></div>
                  <span className="text-xs font-mono font-bold uppercase tracking-widest">
                    {isConnected ? `Live Session: ${roomId}` : connectionError ? `Error: ${connectionError}` : 'Connecting...'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => window.location.reload()}
                    className="px-2 py-1 border border-[#141414]/20 text-[10px] uppercase font-bold hover:bg-gray-100 transition-colors"
                  >
                    새로고침
                  </button>
                  <button 
                    onClick={() => {
                      socket?.emit('keypress', { roomId, char: '!' });
                      setTimeout(() => socket?.emit('command', { roomId, cmd: 'backspace' }), 500);
                    }}
                    className="px-2 py-1 border border-[#141414]/20 text-[10px] uppercase font-bold hover:bg-gray-100 transition-colors"
                  >
                    연결 테스트
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
              <h3 className="text-xs font-bold uppercase tracking-widest mb-4 opacity-50">연결이 안 되나요? (해결 방법)</h3>
              <div className="space-y-4 text-xs text-gray-600">
                <div className="p-3 bg-red-50 border border-red-100 rounded">
                  <p className="font-bold text-red-800 mb-1">초록불이 안 들어올 때:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>인터넷 연결을 확인하고 <b>새로고침</b> 버튼을 눌러주세요.</li>
                    <li>공공 와이파이나 회사 보안망에서는 차단될 수 있습니다.</li>
                    <li>브라우저를 껐다 켜보거나 다른 브라우저(크롬 등)를 써보세요.</li>
                  </ul>
                </div>
                <div className="p-3 bg-blue-50 border border-blue-100 rounded">
                  <p className="font-bold text-blue-800 mb-1">방 코드가 무엇인가요?</p>
                  <p>내 핸드폰과 컴퓨터를 1:1로 안전하게 연결해주는 '비밀 번호'입니다. 이 코드가 있어야 다른 사람이 내 컴퓨터에 타이핑하는 것을 막을 수 있습니다.</p>
                </div>
              </div>
              
              {/* Debug Log */}
              <div className="mt-6">
                <p className="text-[10px] font-bold uppercase opacity-30 mb-2">Connection Logs</p>
                <div className="bg-gray-900 text-green-400 p-3 rounded font-mono text-[10px] h-24 overflow-y-auto">
                  {debugLog.map((log, i) => <div key={i}>{log}</div>)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Sender (Mobile Keyboard)
  const handleTouchMove = (e: React.TouchEvent) => {
    if (activeTab !== 'mouse' || !socket || !roomId) return;
    const touch = e.touches[0];
    if (mouseRef.current.x !== 0 && mouseRef.current.y !== 0) {
      const dx = touch.clientX - mouseRef.current.x;
      const dy = touch.clientY - mouseRef.current.y;
      socket.emit('mouse-move', { roomId, dx, dy });
    }
    mouseRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = () => {
    mouseRef.current = { x: 0, y: 0 };
  };

  return (
    <div className="fixed inset-0 bg-[#151619] flex flex-col font-mono text-white overflow-hidden select-none touch-none">
      {/* Header */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between bg-[#1c1d21]">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500 animate-pulse'}`}></div>
          <Smartphone className="w-4 h-4 text-gray-500" />
          <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
            {isConnected ? `Room: ${roomId}` : 'Connecting...'}
          </span>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => setActiveTab('keyboard')}
            className={`p-2 rounded-lg transition-colors ${activeTab === 'keyboard' ? 'bg-blue-500 text-white' : 'text-gray-500'}`}
          >
            <Type className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setActiveTab('mouse')}
            className={`p-2 rounded-lg transition-colors ${activeTab === 'mouse' ? 'bg-blue-500 text-white' : 'text-gray-500'}`}
          >
            <MousePointer2 className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setMode('choice')}
            className="p-2 text-gray-500 hover:text-white"
          >
            <CornerDownLeft className="w-5 h-5" />
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'keyboard' ? (
          <motion.div 
            key="keyboard"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="flex-1 flex flex-col"
          >
            {/* Preview Area */}
            <div className="flex-1 flex flex-col items-center justify-center p-8">
              <div className="text-center">
                <div className="text-5xl font-bold mb-4 min-h-[1.2em] text-blue-400 drop-shadow-lg">
                  {lastChar ? KEYPAD_CONFIG.find(k => k.id === lastChar)?.[inputMode][tapCount] : ' '}
                </div>
                <div className="px-3 py-1 bg-white/5 rounded-full text-[10px] uppercase tracking-[0.2em] text-gray-400 border border-white/10">
                  {inputMode === 'ko' ? '한글 입력' : inputMode === 'en' ? 'English' : 'Numbers'}
                </div>
              </div>
              
              <div className="mt-12 flex gap-4">
                <button 
                  onClick={() => sendCommand('clear')}
                  className="px-6 py-2 border border-red-500/30 text-red-400 text-[10px] uppercase tracking-widest rounded-full hover:bg-red-500/10 transition-colors font-bold"
                >
                  Clear All
                </button>
              </div>
            </div>

            {/* Cheonjiin Keyboard */}
            <div className="bg-[#1c1d21] p-3 pb-10 grid grid-cols-3 gap-3">
              {KEYPAD_CONFIG.map((key) => (
                <motion.button
                  key={key.id}
                  whileTap={{ scale: 0.92, backgroundColor: '#2a2b30' }}
                  onClick={() => handleKeyClick(key.id)}
                  className={`h-20 rounded-2xl flex flex-col items-center justify-center border border-white/5 shadow-xl transition-all ${
                    key.id === '*' ? 'bg-blue-600/20 border-blue-500/40' : 'bg-[#232429]'
                  }`}
                >
                  <span className="text-2xl font-bold mb-1">{key.id}</span>
                  <div className="flex flex-col items-center leading-tight">
                    <span className="text-[10px] text-gray-400 font-bold">{key.label}</span>
                    <span className="text-[8px] text-gray-600 uppercase tracking-tighter">{key.enLabel}</span>
                  </div>
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="mouse"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex-1 flex flex-col p-4"
          >
            <div 
              className="flex-1 bg-[#232429] rounded-3xl border-2 border-white/5 shadow-inner flex items-center justify-center relative overflow-hidden"
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              <div className="text-gray-600 flex flex-col items-center gap-4 pointer-events-none">
                <MousePointer2 className="w-16 h-16 opacity-20" />
                <span className="text-sm font-bold uppercase tracking-widest opacity-30">Trackpad</span>
              </div>
              
              {/* Mouse Buttons */}
              <div className="absolute bottom-6 left-6 right-6 h-24 flex gap-4">
                <button 
                  className="flex-1 bg-white/5 border border-white/10 rounded-2xl active:bg-white/20 transition-colors flex items-center justify-center font-bold uppercase tracking-widest text-xs"
                  onClick={() => socket?.emit('mouse-click', { roomId, button: 'left' })}
                >
                  Left
                </button>
                <button 
                  className="flex-1 bg-white/5 border border-white/10 rounded-2xl active:bg-white/20 transition-colors flex items-center justify-center font-bold uppercase tracking-widest text-xs"
                  onClick={() => socket?.emit('mouse-click', { roomId, button: 'right' })}
                >
                  Right
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Bar */}
      <div className="h-1.5 w-20 bg-white/10 mx-auto mb-3 rounded-full"></div>
    </div>
  );
}
