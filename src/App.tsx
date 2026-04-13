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
  Type
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
  const [roomId, setRoomId] = useState('');
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
  const lastMouseMoveTime = useRef(0);

  const addLog = (msg: string) => {
    setDebugLog(prev => [new Date().toLocaleTimeString() + ': ' + msg, ...prev].slice(0, 5));
  };

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
        setText(assembled || processed.join(''));
        return next;
      });
    } else {
      setText(prev => prev + char);
      setComposition([]); 
    }
  };

  const handleRemoteCommand = (cmd: string) => {
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
    } else if (cmd === 'enter') {
      setText(prev => prev + '\n');
      setComposition([]);
    }
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
      emitEvent('keypress', { char: ' ' });
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
            pyautogui.write(char)
        elif etype == 'command':
            cmd = edata.get('cmd')
            print(f"Command: {cmd}")
            if cmd == 'backspace': pyautogui.press('backspace')
            elif cmd == 'space': pyautogui.press('space')
            elif cmd == 'enter': pyautogui.press('enter')
        elif etype == 'mouse-move':
            dx, dy = edata.get('dx', 0), edata.get('dy', 0)
            # Increased sensitivity and smoother movement
            pyautogui.moveRel(dx * 1.5, dy * 1.5, duration=0.05)
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
                        pip install pyautogui firebase-admin
                      </code>
                    </li>
                    <li>Firebase 콘솔에서 <b>서비스 계정 키(JSON)</b>를 다운로드하여 <code className="text-white">serviceAccountKey.json</code>으로 저장합니다.</li>
                    <li>오른쪽 코드를 <code className="text-white">helper.py</code>로 저장하고 같은 폴더에서 실행합니다.</li>
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
    if (activeTab !== 'mouse' || !roomId) return;
    const touch = e.touches[0];
    const now = Date.now();
    
    if (mouseRef.current.x !== 0 && mouseRef.current.y !== 0) {
      const dx = touch.clientX - mouseRef.current.x;
      const dy = touch.clientY - mouseRef.current.y;
      
      // Throttle mouse moves to 50ms to avoid Firestore limits
      if (now - lastMouseMoveTime.current > 50) {
        emitEvent('mouse-move', { dx: dx * 3, dy: dy * 3 }); // Increased sensitivity
        lastMouseMoveTime.current = now;
      }
    }
    mouseRef.current = { x: touch.clientX, y: touch.clientY };
  };

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
                  {lastChar ? (inputMode === 'sym' ? lastChar : KEYPAD_CONFIG.find(k => k.id === lastChar)?.[inputMode === 'sym' ? 'num' : inputMode][tapCount]) : ' '}
                </div>
                <div className="text-[10px] text-blue-500 font-bold uppercase mt-2">
                  {inputMode === 'ko' ? '한글' : inputMode === 'en' ? 'English' : inputMode === 'num' ? '숫자' : '기호'}
                </div>
              </div>
            </div>

            {/* Galaxy Style Keyboard */}
            <div className="bg-[#D1D3D9] p-1.5 grid grid-cols-4 gap-1.5 pb-8">
              {inputMode === 'sym' ? (
                <>
                  <div className="col-span-4 grid grid-cols-5 gap-1.5">
                    {SYMBOL_CONFIG.map(sym => (
                      <button
                        key={sym}
                        onClick={() => handleKeyClick(sym)}
                        className="h-12 bg-white rounded-lg shadow-sm flex items-center justify-center text-lg active:bg-gray-200"
                      >
                        {sym}
                      </button>
                    ))}
                  </div>
                  <button 
                    onClick={() => setInputMode('ko')}
                    className="col-span-4 h-12 bg-[#B0B3BC] rounded-lg shadow-sm flex items-center justify-center text-sm font-bold active:bg-gray-400"
                  >
                    뒤로가기
                  </button>
                </>
              ) : (
                <>
                  {/* Row 1-3: Main Keys + Side Functions */}
                  <div className="col-span-3 grid grid-cols-3 gap-1.5">
                    {KEYPAD_CONFIG.slice(0, 9).map(key => (
                      <button
                        key={key.id}
                        onClick={() => handleKeyClick(key.id)}
                        className="h-14 bg-white rounded-lg shadow-sm flex flex-col items-center justify-center active:bg-gray-200"
                      >
                        <span className="text-xl font-medium">{key.label}</span>
                        {inputMode === 'en' && <span className="text-[8px] text-gray-400 uppercase">{key.en.join('')}</span>}
                      </button>
                    ))}
                  </div>

                  <div className="col-span-1 flex flex-col gap-1.5">
                    <button 
                      onClick={() => handleKeyClick('backspace')}
                      className="flex-1 bg-[#B0B3BC] rounded-lg shadow-sm flex items-center justify-center active:bg-gray-400"
                    >
                      <Delete className="w-5 h-5" />
                    </button>
                    <button 
                      onClick={() => handleKeyClick('enter')}
                      className="flex-1 bg-[#B0B3BC] rounded-lg shadow-sm flex items-center justify-center active:bg-gray-400"
                    >
                      <CornerDownLeft className="w-5 h-5" />
                    </button>
                    <button 
                      onClick={() => handleKeyClick('punct')}
                      className="flex-1 bg-[#B0B3BC] rounded-lg shadow-sm flex items-center justify-center text-lg font-bold active:bg-gray-400"
                    >
                      .,?!
                    </button>
                  </div>

                  {/* Bottom Row */}
                  <button 
                    onClick={() => setInputMode('sym')}
                    className="h-14 bg-[#B0B3BC] rounded-lg shadow-sm flex items-center justify-center text-sm font-bold active:bg-gray-400"
                  >
                    !#1
                  </button>
                  <button 
                    onClick={() => handleKeyClick('mode')}
                    className="h-14 bg-[#B0B3BC] rounded-lg shadow-sm flex items-center justify-center text-xs font-bold active:bg-gray-400"
                  >
                    한/영
                  </button>
                  <button 
                    onClick={() => handleKeyClick('0')}
                    className="h-14 bg-white rounded-lg shadow-sm flex flex-col items-center justify-center active:bg-gray-200"
                  >
                    <span className="text-xl font-medium">ㅇㅁ</span>
                  </button>
                  <button 
                    onClick={() => handleKeyClick('space')}
                    className="h-14 bg-[#B0B3BC] rounded-lg shadow-sm flex items-center justify-center active:bg-gray-400"
                  >
                    <Space className="w-6 h-6" />
                  </button>
                </>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="mouse"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col p-6"
          >
            <div 
              className="flex-1 bg-white rounded-3xl border border-gray-200 shadow-sm flex items-center justify-center relative overflow-hidden"
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              <div className="text-gray-300 flex flex-col items-center gap-4 pointer-events-none">
                <MousePointer2 className="w-20 h-20 opacity-20" />
                <span className="text-[10px] font-bold uppercase tracking-[0.3em] opacity-50">Trackpad</span>
              </div>
              
              <div className="absolute bottom-8 left-8 right-8 h-24 flex gap-4">
                <button 
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl active:bg-gray-200 transition-colors flex items-center justify-center font-bold uppercase text-[10px] tracking-widest text-gray-500"
                  onClick={() => emitEvent('mouse-click', { button: 'left' })}
                >
                  Left
                </button>
                <button 
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl active:bg-gray-200 transition-colors flex items-center justify-center font-bold uppercase text-[10px] tracking-widest text-gray-500"
                  onClick={() => emitEvent('mouse-click', { button: 'right' })}
                >
                  Right
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Bar */}
      <div className="h-1.5 w-20 bg-gray-300 mx-auto mb-3 rounded-full"></div>
    </div>
  );
}
