import { useState, useEffect, useCallback, useRef } from 'react';
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
  Type,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as Hangul from 'hangul-js';
import { db } from './firebase';
import { 
  doc, 
  setDoc, 
  onSnapshot, 
  updateDoc, 
  serverTimestamp,
  getDoc
} from 'firebase/firestore';

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
  { id: '0', label: 'ㅇㅁ', ko: ['ㅇ', 'ㅁ'], en: [' '], num: ['0'] },
];

const SYMBOL_CONFIG = [
  '!', '@', '#', '$', '%', '^', '&', '*', '(', ')',
  '-', '+', '=', '[', ']', '{', '}', ';', ':', '"',
  '\'', ',', '.', '<', '>', '/', '?', '\\', '|', '~'
];

type InputMode = 'ko' | 'en' | 'num' | 'sym';
type MobileTab = 'keyboard' | 'mouse';

export default function App() {
  const [mode, setMode] = useState<'choice' | 'sender' | 'receiver'>('choice');
  const [inputMode, setInputMode] = useState<InputMode>('ko');
  const [activeTab, setActiveTab] = useState<MobileTab>('keyboard');
  const [isAirMouseActive, setIsAirMouseActive] = useState(false);
  const [mouseSensitivity, setMouseSensitivity] = useState(1.5);
  const [roomId, setRoomId] = useState('');
  const [committedText, setCommittedText] = useState('');
  const [composition, setComposition] = useState<string[]>([]);
  const [lastChar, setLastChar] = useState<string | null>(null);
  const [tapCount, setTapCount] = useState(0);
  const tapTimer = useRef<NodeJS.Timeout | null>(null);
  const backspaceInterval = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  
  // Mouse state
  const mouseRef = useRef({ x: 0, y: 0 });
  const lastMouseMoveTime = useRef(0);

  const addLog = (msg: string) => {
    setDebugLog(prev => [new Date().toLocaleTimeString() + ': ' + msg, ...prev].slice(0, 5));
  };

  // Handle URL Parameters for Auto-Connect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    const modeParam = params.get('mode');

    if (roomParam && (modeParam === 'sender' || modeParam === 'receiver')) {
      setRoomId(roomParam);
      setMode(modeParam as any);
      addLog(`Auto-connecting to ${roomParam} as ${modeParam}`);
    }
  }, []);

  // Initialize Firebase Connection Status
  useEffect(() => {
    if (!roomId) return;
    
    addLog(`Connecting to room: ${roomId}`);
    
    const roomRef = doc(db, 'rooms', roomId);
    
    let lastProcessedTimestamp = Date.now();

    // Listen for events (Receiver logic)
    const unsubscribe = onSnapshot(roomRef, (snapshot) => {
      if (!snapshot.exists()) {
        setIsConnected(false);
        return;
      }
      
      setIsConnected(true);
      setConnectionError(null);
      
      const data = snapshot.data();
      const event = data.lastEvent;
      
      if (event && mode === 'receiver') {
        // Only process new events
        if (event.timestamp && event.timestamp > lastProcessedTimestamp) {
          lastProcessedTimestamp = event.timestamp;
          
          // Handle events based on type
          if (event.type === 'keypress') {
            handleRemoteKeypress(event.data.char);
          } else if (event.type === 'command') {
            handleRemoteCommand(event.data.cmd);
          } else if (event.type === 'mouse-move') {
            console.log('Mouse move:', event.data.dx, event.data.dy);
          } else if (event.type === 'mouse-click') {
            console.log('Mouse click:', event.data.button);
          }
        }
      }
    }, (err) => {
      setConnectionError(err.message);
      addLog(`Firebase error: ${err.message}`);
    });

    return () => unsubscribe();
  }, [roomId, mode]);

  const handleRemoteKeypress = (char: string) => {
    const isKorean = /[ㄱ-ㅎㅏ-ㅣㆍ]/.test(char);
    
    if (isKorean) {
      setComposition(prev => [...prev, char]);
    } else {
      const processed = processCheonjiin(composition);
      const assembled = Hangul.assemble(processed);
      setCommittedText(prev => prev + (assembled || processed.join('')) + char);
      setComposition([]); 
    }
  };

  const handleRemoteCommand = (cmd: string) => {
    if (cmd === 'backspace') {
      if (composition.length > 0) {
        setComposition(prev => prev.slice(0, -1));
      } else {
        setCommittedText(prev => prev.slice(0, -1));
      }
    } else if (cmd === 'clear') {
      setComposition([]);
      setCommittedText('');
    } else if (cmd === 'enter') {
      const processed = processCheonjiin(composition);
      const assembled = Hangul.assemble(processed);
      setCommittedText(prev => prev + (assembled || processed.join('')) + '\n');
      setComposition([]);
    } else if (cmd === 'space') {
      const processed = processCheonjiin(composition);
      const assembled = Hangul.assemble(processed);
      setCommittedText(prev => prev + (assembled || processed.join('')) + ' ');
      setComposition([]);
    }
  };

  const getDisplayText = () => {
    const processed = processCheonjiin(composition);
    const assembled = Hangul.assemble(processed);
    return committedText + (assembled || processed.join(''));
  };

  // Emit Event Helper
  const emitEvent = async (type: string, data: any) => {
    if (!roomId) return;
    try {
      const roomRef = doc(db, 'rooms', roomId);
      await setDoc(roomRef, {
        id: roomId,
        lastEvent: {
          type,
          data,
          timestamp: Date.now() // Using client timestamp for immediate ordering
        },
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      console.error('Emit error:', err);
    }
  };

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
      'ㅣㆍ': 'ㅏ', 'ㅣㆍㆍ': 'ㅑ', 'ㆍㅣ': 'ㅓ', 'ㆍㆍㅣ': 'ㅕ',
      'ㆍㅡ': 'ㅗ', 'ㆍㆍㅡ': 'ㅛ', 'ㅡㆍ': 'ㅜ', 'ㅡㆍㆍ': 'ㅠ',
      'ㅡㅣ': 'ㅢ', 'ㅣㆍㅣ': 'ㅐ', 'ㅣㆍㆍㅣ': 'ㅒ', 'ㆍㅣㅣ': 'ㅔ',
      'ㆍㆍㅣㅣ': 'ㅖ', 'ㆍㅡㅣ': 'ㅚ', 'ㅡㆍㅣ': 'ㅟ', 'ㅣㆍㅡㅣ': 'ㅘ',
      'ㅣㆍㅡㅣㅣ': 'ㅙ', 'ㆍㅡㅣㆍㅣ': 'ㅝ', 'ㆍㅡㅣㆍㅣㅣ': 'ㅞ',
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
    if (!roomId) return;

    if (keyId === 'mode') {
      const modes: InputMode[] = ['ko', 'en', 'num', 'sym'];
      const nextMode = modes[(modes.indexOf(inputMode) + 1) % modes.length];
      setInputMode(nextMode);
      setLastChar(null);
      setTapCount(0);
      return;
    }

    if (keyId === 'backspace') {
      emitEvent('command', { cmd: 'backspace' });
      setLastChar(null);
      setTapCount(0);
      return;
    }

    if (keyId === 'enter') {
      emitEvent('command', { cmd: 'enter' });
      setLastChar(null);
      setTapCount(0);
      return;
    }

    if (keyId === 'space') {
      emitEvent('command', { cmd: 'space' });
      setLastChar(null);
      setTapCount(0);
      return;
    }

    if (keyId === 'punct') {
      emitEvent('keypress', { char: '.' });
      setLastChar(null);
      setTapCount(0);
      return;
    }

    if (inputMode === 'sym') {
      emitEvent('keypress', { char: keyId });
      return;
    }

    const config = KEYPAD_CONFIG.find(k => k.id === keyId);
    if (!config) return;

    const chars = config[inputMode === 'sym' ? 'num' : inputMode];
    const isVowel = inputMode === 'ko' && ['1', '2', '3'].includes(keyId);

    if (lastChar === keyId && !isVowel && inputMode !== 'num') {
      // Multi-tap
      emitEvent('command', { cmd: 'backspace' });
      const nextTap = (tapCount + 1) % chars.length;
      setTapCount(nextTap);
      emitEvent('keypress', { char: chars[nextTap] });
      
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
      emitEvent('keypress', { char: chars[0] });
      
      if (!isVowel && inputMode !== 'num') {
        tapTimer.current = setTimeout(() => {
          setLastChar(null);
        }, 800);
      } else {
        setLastChar(null);
      }
    }
  };

  const startBackspace = () => {
    if (backspaceInterval.current) return;
    handleKeyClick('backspace');
    backspaceInterval.current = setInterval(() => {
      handleKeyClick('backspace');
    }, 150);
  };

  const stopBackspace = () => {
    if (backspaceInterval.current) {
      clearInterval(backspaceInterval.current);
      backspaceInterval.current = null;
    }
  };

  const generateRoom = async () => {
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomId(id);
    setMode('receiver');
    window.history.pushState({}, '', `?mode=receiver&room=${id}`);
    
    // Create room in Firestore
    try {
      await setDoc(doc(db, 'rooms', id), {
        id,
        createdAt: serverTimestamp(),
        lastEvent: null
      });
      addLog(`Room created: ${id}`);
    } catch (err) {
      console.error('Room creation error:', err);
    }
  };

  const sendCommand = (cmd: string) => {
    emitEvent('command', { cmd });
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(getDisplayText());
  };

  const getPythonScript = () => `
import firebase_admin
from firebase_admin import credentials, firestore
import pyautogui
import time
import threading

# 1. Download your service account key from Firebase Console
# 2. Rename it to 'serviceAccountKey.json' and put it in the same folder
try:
    cred = credentials.Certificate('serviceAccountKey.json')
    firebase_admin.initialize_app(cred)
    db = firestore.client()
except Exception as e:
    print(f"Error initializing Firebase: {e}")
    print("Please make sure 'serviceAccountKey.json' exists in the same folder.")
    exit()

room_id = '${roomId}'
print(f"Monitoring Room: {room_id}")

last_processed_timestamp = time.time() * 1000

def on_snapshot(doc_snapshot, changes, read_time):
    global last_processed_timestamp
    for doc in doc_snapshot:
        data = doc.to_dict()
        event = data.get('lastEvent')
        if not event: continue
        
        timestamp = event.get('timestamp', 0)
        if timestamp <= last_processed_timestamp:
            continue
            
        last_processed_timestamp = timestamp
        
        etype = event.get('type')
        edata = event.get('data', {})
        
        if etype == 'keypress':
            char = edata.get('char')
            print(f"Typing: {char}")
            if ord(char) > 127: # If it's a non-ASCII character (like Korean)
                import pyperclip
                pyperclip.copy(char)
                if pyautogui._pyautogui_win: # Windows
                    pyautogui.hotkey('ctrl', 'v')
                else: # Mac/Linux
                    pyautogui.hotkey('command', 'v')
            else:
                pyautogui.write(char)
        elif etype == 'command':
            cmd = edata.get('cmd')
            print(f"Command: {cmd}")
            if cmd == 'backspace': pyautogui.press('backspace')
            elif cmd == 'space': pyautogui.press('space')
            elif cmd == 'enter': pyautogui.press('enter')
        elif etype == 'mouse-move':
            dx, dy = edata.get('dx', 0), edata.get('dy', 0)
            # Instant movement for better responsiveness
            pyautogui.moveRel(dx, dy)
        elif etype == 'mouse-click':
            btn = edata.get('button', 'left')
            pyautogui.click(button=btn)

doc_ref = db.collection('rooms').document(room_id)
doc_watch = doc_ref.on_snapshot(on_snapshot)

print("Connected and waiting for events...")
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    pass
`.trim();

  const downloadHelper = () => {
    const blob = new Blob([getPythonScript()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cheonjiin_helper.py';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
    const pythonScript = getPythonScript();

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
                      emitEvent('keypress', { char: '!' });
                      setTimeout(() => emitEvent('command', { cmd: 'backspace' }), 500);
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
                value={getDisplayText()}
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
                  <p>브라우저 밖(메모장, 카톡 등)에 직접 입력하려면 아래 파일을 다운로드하여 실행하세요.</p>
                  <ol className="list-decimal list-inside space-y-2">
                    <li>
                      <button 
                        onClick={downloadHelper}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-700 transition-colors inline-flex items-center gap-2 not-italic"
                      >
                        <Download className="w-4 h-4" />
                        도우미 파일 다운로드 (.py)
                      </button>
                    </li>
                    <li>Python 설치 후 터미널에서 실행:<br/>
                      <code className="bg-white/10 text-blue-300 px-2 py-1 rounded mt-1 inline-block not-italic font-mono text-[10px]">
                        pip install pyautogui firebase-admin pyperclip
                      </code>
                    </li>
                    <li>다운로드한 파일을 실행하면 핸드폰 자판이 컴퓨터 전체에서 작동합니다!</li>
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
  const handleTouchMove = (e: any) => {
    if (activeTab !== 'mouse' || !roomId || isAirMouseActive) return;
    const touch = e.touches[0];
    const now = Date.now();
    
    if (mouseRef.current.x !== 0 && mouseRef.current.y !== 0) {
      const dx = touch.clientX - mouseRef.current.x;
      const dy = touch.clientY - mouseRef.current.y;
      
      // Throttle mouse moves to 30ms for better responsiveness
      if (now - lastMouseMoveTime.current > 30) {
        emitEvent('mouse-move', { dx: dx * mouseSensitivity, dy: dy * mouseSensitivity });
        lastMouseMoveTime.current = now;
      }
    }
    mouseRef.current = { x: touch.clientX, y: touch.clientY };
  };

  // Air Mouse (Gyroscope) Logic
  useEffect(() => {
    if (!isAirMouseActive || activeTab !== 'mouse' || !roomId) return;

    let lastX = 0;
    let lastY = 0;
    let lastTime = Date.now();

    const handleOrientation = (e: DeviceOrientationEvent) => {
      const now = Date.now();
      if (now - lastTime < 40) return; // Throttle

      // Use beta (tilt front/back) and gamma (tilt left/right)
      const dx = (e.gamma || 0);
      const dy = (e.beta || 0);

      // Simple deadzone and scaling
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        emitEvent('mouse-move', { dx: dx * mouseSensitivity * 0.5, dy: dy * mouseSensitivity * 0.5 });
        lastTime = now;
      }
    };

    window.addEventListener('deviceorientation', handleOrientation);
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, [isAirMouseActive, activeTab, roomId, mouseSensitivity]);

  const handleTouchEnd = () => {
    mouseRef.current = { x: 0, y: 0 };
  };

  return (
    <div className="fixed inset-0 bg-[#F2F2F2] flex flex-col font-sans text-[#1c1d21] overflow-hidden select-none touch-none">
      {/* Header */}
      <div className="p-3 flex items-center justify-between bg-white border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`}></div>
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
            {isConnected ? `ROOM: ${roomId}` : 'CONNECTING...'}
          </span>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setActiveTab('keyboard')}
            className={`p-2 rounded-full transition-all ${activeTab === 'keyboard' ? 'bg-gray-100 text-blue-600' : 'text-gray-400'}`}
          >
            <Type className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setActiveTab('mouse')}
            className={`p-2 rounded-full transition-all ${activeTab === 'mouse' ? 'bg-gray-100 text-blue-600' : 'text-gray-400'}`}
          >
            <MousePointer2 className="w-5 h-5" />
          </button>
          <button onClick={() => setMode('choice')} className="p-2 text-gray-400">
            <CornerDownLeft className="w-5 h-5" />
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'keyboard' ? (
          <motion.div 
            key="keyboard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col"
          >
            {/* Preview */}
            <div className="flex-1 flex items-center justify-center p-4 bg-white/50">
              <div className="text-center">
                <div className="text-4xl font-light text-gray-800 min-h-[1.2em]">
                  {(() => {
                    const processed = processCheonjiin(composition);
                    const assembled = Hangul.assemble(processed);
                    return assembled || processed.join('') || ' ';
                  })()}
                </div>
                <div className="text-[10px] text-blue-500 font-bold uppercase mt-2">
                  {inputMode === 'ko' ? '한글' : inputMode === 'en' ? 'English' : inputMode === 'num' ? '숫자' : '기호'}
                </div>
              </div>
            </div>

            {/* Galaxy Style Keyboard */}
            <div className="bg-[#D1D3D9] p-1 pb-4">
              {inputMode === 'sym' ? (
                <div className="grid grid-cols-5 gap-1">
                  {SYMBOL_CONFIG.map(sym => (
                    <button
                      key={sym}
                      onClick={() => handleKeyClick(sym)}
                      className="h-9 bg-white rounded-md shadow-sm flex items-center justify-center text-sm active:bg-gray-200"
                    >
                      {sym}
                    </button>
                  ))}
                  <button 
                    onClick={() => setInputMode('ko')}
                    className="col-span-5 h-9 bg-[#B0B3BC] rounded-md shadow-sm flex items-center justify-center text-[10px] font-bold active:bg-gray-400"
                  >
                    뒤로가기
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1">
                  {/* Row 1-3: Main Keys */}
                  {KEYPAD_CONFIG.slice(0, 9).map(key => (
                    <button
                      key={key.id}
                      onClick={() => handleKeyClick(key.id)}
                      className="h-11 bg-white rounded-lg shadow-sm flex flex-col items-center justify-center active:bg-gray-200 transition-colors relative overflow-hidden"
                    >
                      <span className="absolute top-0.5 right-1 text-[11px] font-black text-gray-600">{key.id}</span>
                      <span className="text-base font-bold text-gray-800">{key.label}</span>
                      {inputMode === 'en' && (
                        <span className="text-[7px] text-gray-400 uppercase font-bold tracking-tighter">
                          {key.en.join('')}
                        </span>
                      )}
                    </button>
                  ))}

                  {/* Row 4: Symbols, ㅇㅁ (Center), Backspace */}
                  <button 
                    onClick={() => setInputMode('sym')}
                    className="h-11 bg-[#B0B3BC] rounded-lg shadow-sm flex items-center justify-center text-[10px] font-bold active:bg-gray-400"
                  >
                    !#1
                  </button>
                  <button 
                    onClick={() => handleKeyClick('0')}
                    className="h-11 bg-white rounded-lg shadow-sm flex flex-col items-center justify-center active:bg-gray-200 relative"
                  >
                    <span className="absolute top-0.5 right-1 text-[11px] font-black text-gray-600">0</span>
                    <span className="text-base font-bold text-gray-800">ㅇㅁ</span>
                  </button>
                  <button 
                    onMouseDown={startBackspace}
                    onMouseUp={stopBackspace}
                    onMouseLeave={stopBackspace}
                    onTouchStart={startBackspace}
                    onTouchEnd={stopBackspace}
                    className="h-11 bg-[#B0B3BC] rounded-lg shadow-sm flex items-center justify-center active:bg-gray-400"
                  >
                    <Delete className="w-4 h-4" />
                  </button>

                  {/* Row 5: Mode, Space, Enter */}
                  <button 
                    onClick={() => handleKeyClick('mode')}
                    className="h-11 bg-[#B0B3BC] rounded-lg shadow-sm flex items-center justify-center text-[9px] font-bold active:bg-gray-400"
                  >
                    한/영
                  </button>
                  <button 
                    onClick={() => handleKeyClick('space')}
                    className="h-11 bg-white rounded-lg shadow-sm flex items-center justify-center active:bg-gray-200"
                  >
                    <Space className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => handleKeyClick('enter')}
                    className="h-11 bg-[#B0B3BC] rounded-lg shadow-sm flex items-center justify-center active:bg-gray-400"
                  >
                    <CornerDownLeft className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="mouse"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col p-4 gap-4"
          >
            {/* Sensitivity & Air Mouse Controls */}
            <div className="flex items-center justify-between bg-white p-3 rounded-2xl border border-gray-200 shadow-sm">
              <div className="flex items-center gap-2">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Sensitivity</div>
                <input 
                  type="range" 
                  min="0.5" 
                  max="5" 
                  step="0.1" 
                  value={mouseSensitivity}
                  onChange={(e) => setMouseSensitivity(parseFloat(e.target.value))}
                  className="w-24 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>
              <button 
                onClick={() => {
                  if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
                    (DeviceOrientationEvent as any).requestPermission()
                      .then((permissionState: string) => {
                        if (permissionState === 'granted') {
                          setIsAirMouseActive(!isAirMouseActive);
                        }
                      });
                  } else {
                    setIsAirMouseActive(!isAirMouseActive);
                  }
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all ${isAirMouseActive ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' : 'bg-gray-100 text-gray-500'}`}
              >
                <RefreshCw className={`w-3 h-3 ${isAirMouseActive ? 'animate-spin' : ''}`} />
                Air Mouse {isAirMouseActive ? 'ON' : 'OFF'}
              </button>
            </div>

            <div 
              className={`flex-1 rounded-3xl border-2 flex items-center justify-center relative overflow-hidden transition-all ${isAirMouseActive ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200 shadow-sm'}`}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              <div className="text-gray-300 flex flex-col items-center gap-4 pointer-events-none">
                {isAirMouseActive ? (
                  <>
                    <RefreshCw className="w-20 h-20 text-blue-200 animate-pulse" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-blue-400">Tilt to Move</span>
                  </>
                ) : (
                  <>
                    <MousePointer2 className="w-20 h-20 opacity-20" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.3em] opacity-50">Trackpad</span>
                  </>
                )}
              </div>
              
              <div className="absolute bottom-6 left-6 right-6 h-28 flex gap-4">
                <button 
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl active:bg-gray-200 active:scale-95 transition-all flex items-center justify-center font-bold uppercase text-[10px] tracking-widest text-gray-500 shadow-sm"
                  onClick={() => emitEvent('mouse-click', { button: 'left' })}
                >
                  Left Click
                </button>
                <button 
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl active:bg-gray-200 active:scale-95 transition-all flex items-center justify-center font-bold uppercase text-[10px] tracking-widest text-gray-500 shadow-sm"
                  onClick={() => emitEvent('mouse-click', { button: 'right' })}
                >
                  Right Click
                </button>
              </div>
            </div>
            
            <p className="text-[10px] text-center text-gray-400 italic">
              {isAirMouseActive ? "핸드폰을 기울여서 마우스를 움직이세요" : "트랙패드를 문질러서 마우스를 움직이세요"}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Bar */}
      <div className="h-1.5 w-20 bg-gray-300 mx-auto mb-3 rounded-full"></div>
    </div>
  );
}
