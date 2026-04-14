import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  getDoc,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  where
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
  { id: '8', label: 'ㅅㅎ', ko: ['ㅅ', 'ㅎ', 'ㅆ'], en: ['w', 'x', 'y', 'z'], num: ['8'] },
  { id: '9', label: 'ㅈㅊ', ko: ['ㅈ', 'ㅊ', 'ㅉ'], en: ['.', ',', '!', '?'], num: ['9'] },
  { id: '0', label: 'ㅇㅁ', ko: ['ㅇ', 'ㅁ'], en: [' '], num: ['0'] },
  { id: 'punct', label: '.,?!', ko: ['.', ',', '?', '!'], en: ['.', ',', '?', '!'], num: ['.', ',', '?', '!'] },
];

const SYMBOL_LAYOUT_1 = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['+', '×', '÷', '=', '/', '_', '<', '>', '[', ']'],
  ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')'],
  ['1/2', '-', '\'', '"', ':', ';', ',', '?', 'backspace'],
  ['ABC', 'mode', ',', 'space', '.', 'enter']
];

const SYMBOL_LAYOUT_2 = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['`', '~', '\\', '|', '{', '}', '€', '£', '¥', '₩'],
  ['°', '•', '○', '●', '□', '■', '♤', '♡', '♢', '♧'],
  ['2/2', '☆', '▪︎', '¤', '《', '》', '¡', '¿', 'backspace'],
  ['ABC', 'mode', ',', 'space', '.', 'enter']
];

const SYMBOL_CONFIG = [
  '!', '@', '#', '$', '%', '^', '&', '*', '(', ')',
  '-', '+', '=', '[', ']', '{', '}', ';', ':', '"',
  '\'', ',', '.', '<', '>', '/', '?', '\\', '|', '~'
];

type InputMode = 'ko' | 'en' | 'num' | 'sym';
type MobileTab = 'keyboard' | 'mouse';

export default function App() {
  const [mode, setMode] = useState<'choice' | 'sender' | 'receiver'>(() => {
    if (typeof window === 'undefined') return 'choice';
    try {
      const params = new URLSearchParams(window.location.search);
      const modeParam = params.get('mode');
      if (modeParam === 'sender' || modeParam === 'receiver') return modeParam as any;
    } catch (e) {
      console.error("Mode init error", e);
    }
    return 'choice';
  });
  const [inputMode, setInputMode] = useState<InputMode>('ko');
  const [symbolPage, setSymbolPage] = useState<1 | 2>(1);
  const [activeTab, setActiveTab] = useState<MobileTab>('keyboard');
  const [isAirMouseActive, setIsAirMouseActive] = useState(false);
  const [mouseSensitivity, setMouseSensitivity] = useState(1.5);
  const [roomId, setRoomId] = useState(() => {
    if (typeof window === 'undefined') return '';
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('room') || '';
    } catch (e) {
      console.error("RoomId init error", e);
      return '';
    }
  });
  const [inputState, setInputState] = useState({
    committedText: '',
    composition: [] as string[]
  });
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const mousePosRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    mousePosRef.current = mousePos;
  }, [mousePos]);
  const eventSeq = useRef(0);

  const [isCompact, setIsCompact] = useState(false);
  const [autoCopy, setAutoCopy] = useState(false);
  const [lastCopiedText, setLastCopiedText] = useState('');
  const [copyFeedback, setCopyFeedback] = useState(false);

  const [lastChar, setLastChar] = useState<string | null>(null);
  const [tapCount, setTapCount] = useState(0);
  const tapTimer = useRef<NodeJS.Timeout | null>(null);
  const backspaceInterval = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [hasError, setHasError] = useState(false);
  const [errorInfo, setErrorInfo] = useState<string>('');
  const [shiftState, setShiftState] = useState<0 | 1 | 2>(0); // 0: off, 1: once, 2: locked
  
  // Viewport Height Fix for Mobile
  useEffect(() => {
    const setVh = () => {
      let vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };
    setVh();
    window.addEventListener('resize', setVh);
    return () => window.removeEventListener('resize', setVh);
  }, []);

  // Global Error Listener
  useEffect(() => {
    const handleError = (e: ErrorEvent) => {
      setHasError(true);
      setErrorInfo(e.message);
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

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
    const eventsRef = collection(roomRef, 'events');
    
    let lastProcessedTimestamp = Date.now();

    // Listen for room status and state sync
    const unsubRoom = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setIsConnected(true);
        setConnectionError(null);
        // Sync input state from Sender to Receiver
        if (mode === 'receiver' && data.inputState) {
          setInputState(data.inputState);
        }
      } else {
        setIsConnected(false);
      }
    });

    // Listen for events (Receiver logic - Mouse/Clicks only)
    const q = query(eventsRef, where('timestamp', '>', lastProcessedTimestamp), orderBy('timestamp', 'asc'), orderBy('seq', 'asc'));
    const unsubEvents = onSnapshot(q, (snapshot) => {
      if (mode !== 'receiver') return;
      
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const event = change.doc.data();
          if (event.timestamp > lastProcessedTimestamp) {
            lastProcessedTimestamp = event.timestamp;
            if (event.type === 'mousemove' || event.type === 'mouse-move') {
              const dx = event.data.dx || 0;
              const dy = event.data.dy || 0;
              setMousePos(prev => {
                const newPos = {
                  x: Math.max(0, Math.min(window.innerWidth, prev.x + dx)),
                  y: Math.max(0, Math.min(window.innerHeight, prev.y + dy))
                };
                return newPos;
              });
            } else if (event.type === 'click' || event.type === 'mouse-click') {
              const el = document.elementFromPoint(mousePosRef.current.x, mousePosRef.current.y);
              if (el instanceof HTMLElement) el.click();
            }
          }
        }
      });
    }, (err) => {
      setConnectionError(err.message);
      addLog(`Firebase error: ${err.message}`);
    });

    return () => {
      unsubRoom();
      unsubEvents();
    };
  }, [roomId, mode]);

  useEffect(() => {
    if (autoCopy && mode === 'receiver') {
      const text = getDisplayText();
      if (text && text !== lastCopiedText) {
        navigator.clipboard.writeText(text).then(() => {
          setLastCopiedText(text);
          setCopyFeedback(true);
          setTimeout(() => setCopyFeedback(false), 1000);
        }).catch(() => {
          // Silent fail for auto-copy if tab is inactive
        });
      }
    }
  }, [inputState.committedText, autoCopy, mode]);

  const handleRemoteCommand = (cmd: string) => {
    handleInput(cmd, true);
  };

  const getDisplayText = () => {
    const processed = processCheonjiin(inputState.composition);
    // Special case: if composition is just one dot, don't let Hangul.assemble turn it into 'ㅏ'
    const assembled = (processed.length === 1 && processed[0] === 'ㆍ') ? 'ㆍ' : Hangul.assemble(processed);
    const fullText = inputState.committedText + (assembled || processed.join(''));
    
    if (mode === 'sender') {
      // Only show text after the last newline for a cleaner mobile experience
      const lines = fullText.split('\n');
      return lines[lines.length - 1];
    }
    return fullText;
  };

  // Emit Event Helper
  const emitEvent = async (type: string, data: any) => {
    if (!roomId) return;
    addLog(`Emitting ${type}`);
    try {
      const roomRef = doc(db, 'rooms', roomId);
      const eventsRef = collection(roomRef, 'events');
      
      // Update room heartbeat
      setDoc(roomRef, { 
        id: roomId, 
        updatedAt: serverTimestamp() 
      }, { merge: true });

      // Add event to subcollection
      await addDoc(eventsRef, {
        type,
        data,
        timestamp: Date.now(),
        seq: eventSeq.current++
      });
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
      'ㆍㆍㅣㅣ': 'ㅖ', 'ㆍㅡㅣ': 'ㅚ', 'ㅡㆍㅣ': 'ㅟ',
      'ㆍㅡㅣㆍ': 'ㅘ',
      'ㆍㅡㅣㆍㅣ': 'ㅙ',
      'ㅡㆍㆍㅣ': 'ㅝ',
      'ㅡㆍㆍㅣㅣ': 'ㅞ',
      'ㅡㆍㅣㆍㅣ': 'ㅙ', // User specific request
      'ㅣ': 'ㅣ', 'ㆍ': 'ㆍ', 'ㅡ': 'ㅡ'
    };
    // Special case for single building blocks to ensure they show up
    if (seq === 'ㆍ') return 'ㆍ'; 
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

  const handleInput = (input: string, isCommand: boolean = false) => {
    setInputState(prev => {
      let { committedText, composition } = prev;

      if (isCommand) {
        if (input === 'backspace') {
          if (composition.length > 0) {
            return { ...prev, composition: composition.slice(0, -1) };
          } else {
            return { ...prev, committedText: committedText.slice(0, -1) };
          }
        } else if (input === 'clear') {
          return { committedText: '', composition: [] };
        } else if (input === 'enter') {
          const processed = processCheonjiin(composition);
          const assembled = Hangul.assemble(processed);
          return {
            committedText: committedText + (assembled || processed.join('')) + '\n',
            composition: []
          };
        } else if (input === 'space') {
          const processed = processCheonjiin(composition);
          const assembled = Hangul.assemble(processed);
          return {
            committedText: committedText + (assembled || processed.join('')) + ' ',
            composition: []
          };
        }
        return prev;
      }

      // Handle character input
      const isKorean = /[ㄱ-ㅎㅏ-ㅣㆍ]/.test(input);
      if (isKorean) {
        return { ...prev, composition: [...composition, input] };
      } else {
        const processed = processCheonjiin(composition);
        const assembled = Hangul.assemble(processed);
        return {
          committedText: committedText + (assembled || processed.join('')) + input,
          composition: []
        };
      }
    });
  };

  const handleInputRef = useRef(handleInput);
  handleInputRef.current = handleInput;

  // Sync state to Firestore (Sender -> Receiver)
  useEffect(() => {
    if (mode === 'sender' && roomId && isConnected) {
      const roomRef = doc(db, 'rooms', roomId);
      updateDoc(roomRef, {
        inputState: inputState,
        lastUpdate: serverTimestamp()
      }).catch(err => console.error("Sync error:", err));
    }
  }, [inputState, mode, roomId, isConnected]);

  // Link Laptop Mouse to Virtual Cursor (Receiver side)
  useEffect(() => {
    if (mode === 'receiver') {
      const handleMouseMove = (e: MouseEvent) => {
        setMousePos({ x: e.clientX, y: e.clientY });
      };
      window.addEventListener('mousemove', handleMouseMove);
      return () => window.removeEventListener('mousemove', handleMouseMove);
    }
  }, [mode]);

  const lastClickTime = useRef(0);
  const handleKeyClick = (keyId: string) => {
    if (!roomId) return;

    // Debounce backspace to prevent double-deletion
    if (keyId === 'backspace') {
      const now = Date.now();
      if (now - lastClickTime.current < 100) return;
      lastClickTime.current = now;
    }

    if (keyId === 'mode') {
      const modes: InputMode[] = ['ko', 'en', 'num', 'sym'];
      const nextMode = modes[(modes.indexOf(inputMode) + 1) % modes.length];
      setInputMode(nextMode);
      setLastChar(null);
      setTapCount(0);
      setShiftState(0);
      return;
    }

    if (keyId === 'shift') {
      setShiftState(prev => {
        if (prev === 0) return 1;
        if (prev === 1) return 2;
        return 0;
      });
      return;
    }

    if (keyId === 'backspace') {
      emitEvent('command', { cmd: 'backspace' });
      handleInput('backspace', true);
      setLastChar(null);
      setTapCount(0);
      return;
    }

    if (keyId === 'enter') {
      emitEvent('command', { cmd: 'enter' });
      handleInput('enter', true);
      setLastChar(null);
      setTapCount(0);
      return;
    }

    if (keyId === 'space') {
      emitEvent('command', { cmd: 'space' });
      handleInput('space', true);
      setLastChar(null);
      setTapCount(0);
      return;
    }

    if (inputMode === 'sym') {
      emitEvent('keypress', { char: keyId });
      handleInput(keyId);
      return;
    }

    if (inputMode === 'en' && keyId.length === 1) {
      let char = keyId;
      if (shiftState > 0) {
        char = char.toUpperCase();
      } else {
        char = char.toLowerCase();
      }
      emitEvent('keypress', { char });
      handleInput(char);
      if (shiftState === 1) setShiftState(0); 
      return;
    }

    const config = KEYPAD_CONFIG.find(k => k.id === keyId);
    if (!config) return;

    const chars = config[inputMode === 'sym' ? 'num' : inputMode];
    const isVowel = inputMode === 'ko' && ['1', '2', '3'].includes(keyId);

    if (lastChar === keyId && !isVowel && inputMode !== 'num') {
      // Multi-tap
      emitEvent('command', { cmd: 'backspace' });
      handleInput('backspace', true);
      
      const nextTap = (tapCount + 1) % chars.length;
      setTapCount(nextTap);
      emitEvent('keypress', { char: chars[nextTap] });
      handleInput(chars[nextTap]);
      
      if (tapTimer.current) clearTimeout(tapTimer.current);
      tapTimer.current = setTimeout(() => {
        setLastChar(null);
        setTapCount(0);
      }, 500); // Reduced from 800ms for faster recognition
    } else {
      // New key
      if (tapTimer.current) clearTimeout(tapTimer.current);
      setLastChar(keyId);
      setTapCount(0);
      emitEvent('keypress', { char: chars[0] });
      handleInput(chars[0]);
      
      if (!isVowel && inputMode !== 'num') {
        tapTimer.current = setTimeout(() => {
          setLastChar(null);
        }, 500); // Reduced from 800ms for faster recognition
      } else {
        setLastChar(null);
      }
    }
  };

  const startBackspace = (e?: React.MouseEvent | React.TouchEvent) => {
    if (e) {
      if ('touches' in e) {
        // Prevent mouse events from firing after touch
        if (e.cancelable) e.preventDefault();
      }
    }
    if (backspaceInterval.current) return;
    handleKeyClick('backspace');
    // Slightly slower repeat for better control and reliability
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
    const text = getDisplayText();
    navigator.clipboard.writeText(text).then(() => {
      addLog('Copied to clipboard!');
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1000);
    }).catch(err => {
      console.error('Copy failed', err);
    });
  };

  const copyPythonCommand = () => {
    const cmd = `python -m pip install pyautogui firebase-admin pyperclip; python cheonjiin_helper.py`;
    navigator.clipboard.writeText(cmd).then(() => {
      addLog('Command copied!');
    });
  };

  const getPythonScript = () => `
import requests
import pyautogui
import time
import pyperclip
import json

# Optimize pyautogui for speed
pyautogui.PAUSE = 0.01
pyautogui.FAILSAFE = True

room_id = '${roomId}'
PROJECT_ID = "gen-lang-client-0554047813"
DATABASE_ID = "ai-studio-1127c5b5-9423-4747-86d8-14fb0fe2ab2a"
API_KEY = "AIzaSyD2wmVsk_iswMNVsvcaJrDtxLgezz6dffc"

print(f"Monitoring Room: {room_id}")
print("Starting Cheonjiin Helper (Real-time Polling)...")
print("--------------------------------------------------")
print("1. Click the window you want to type into.")
print("2. Use your phone to type or move the mouse.")
print("--------------------------------------------------")

last_processed_timestamp = int(time.time() * 1000)

def process_event(event_data):
    global last_processed_timestamp
    etype = event_data.get('type')
    edata = event_data.get('data', {})
    ts = event_data.get('timestamp', 0)
    
    if ts <= last_processed_timestamp:
        return
    last_processed_timestamp = ts

    if etype == 'keypress':
        char = edata.get('char')
        if not char: return
        print(f"Typing: {char}")
        if ord(char) > 127: # Korean/Special
            pyperclip.copy(char)
            pyautogui.hotkey('ctrl', 'v')
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
        # Move the ACTUAL laptop mouse
        pyautogui.moveRel(dx, dy)
    elif etype == 'mouse-click':
        btn = edata.get('button', 'left')
        print(f"Click: {btn}")
        pyautogui.click(button=btn)

# Polling loop using runQuery for better performance
query_body = {
    "structuredQuery": {
        "from": [{"collectionId": "events"}],
        "where": {
            "compositeFilter": {
                "op": "AND",
                "filters": [
                    {
                        "fieldFilter": {
                            "field": {"fieldPath": "timestamp"},
                            "op": "GREATER_THAN",
                            "value": {"integerValue": 0} # Will be updated in loop
                        }
                    }
                ]
            }
        },
        "orderBy": [{"field": {"fieldPath": "timestamp"}, "direction": "ASCENDING"}]
    }
}

while True:
    try:
        # Update query with last timestamp to get only NEW events
        query_body["structuredQuery"]["where"]["compositeFilter"]["filters"][0]["fieldFilter"]["value"]["integerValue"] = last_processed_timestamp
        
        # The events are subcollections of rooms/{room_id}/events
        parent_path = f"projects/{PROJECT_ID}/databases/{DATABASE_ID}/documents/rooms/{room_id}"
        response = requests.post(f"https://firestore.googleapis.com/v1/{parent_path}:runQuery?key={API_KEY}", json=query_body)
        
        if response.status_code == 200:
            results = response.json()
            for res in results:
                doc = res.get('document')
                if not doc: continue
                fields = doc.get('fields', {})
                
                # Extract data
                event_data = {
                    "type": fields.get('type', {}).get('stringValue'),
                    "timestamp": int(fields.get('timestamp', {}).get('integerValue', 0)),
                    "data": {}
                }
                
                raw_data = fields.get('data', {}).get('mapValue', {}).get('fields', {})
                for k, v in raw_data.items():
                    if 'stringValue' in v: event_data['data'][k] = v['stringValue']
                    elif 'integerValue' in v: event_data['data'][k] = int(v['integerValue'])
                    elif 'doubleValue' in v: event_data['data'][k] = float(v['doubleValue'])
                
                process_event(event_data)
        
        time.sleep(0.1) # Faster polling
    except KeyboardInterrupt:
        break
    except Exception as e:
        print(f"Error: {e}")
        time.sleep(1)
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

            <div className="space-y-3">
              <label className="text-xs font-bold uppercase tracking-widest opacity-50 block">방 코드 직접 입력</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder="예: ABCDEF"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  className="flex-1 p-4 border-2 border-[#141414] font-mono text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg"
                />
                <button 
                  onClick={() => {
                    if (roomId) {
                      setMode('sender');
                      window.history.pushState({}, '', `?mode=sender&room=${roomId}`);
                    }
                  }}
                  className="px-6 bg-[#141414] text-white hover:bg-gray-800 transition-all active:scale-95 rounded-lg flex items-center justify-center shadow-lg"
                >
                  <Smartphone className="w-6 h-6" />
                </button>
              </div>
              <p className="text-[10px] text-gray-400 text-center italic">QR 코드가 안 될 경우 코드를 직접 입력하세요</p>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  if (mode === 'receiver') {
    const getBaseUrl = () => {
      const url = new URL(window.location.href);
      return url.origin + url.pathname;
    };
    const shareUrl = `${getBaseUrl()}?mode=sender&room=${roomId}`;
    const pythonScript = getPythonScript();

    if (isCompact) {
      return (
        <div className="fixed bottom-4 right-4 w-80 bg-white border-2 border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] z-[10000] flex flex-col overflow-hidden">
          <div className="bg-[#141414] text-white p-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-[10px] font-bold uppercase tracking-widest">Mini Mode</span>
            </div>
            <button onClick={() => setIsCompact(false)} className="p-1 hover:bg-white/20 rounded">
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
          <div className="p-3 space-y-3">
            <div className="relative">
              <textarea 
                value={getDisplayText()}
                readOnly
                onClick={copyToClipboard}
                className="w-full h-32 p-3 text-lg font-medium bg-gray-50 border border-dashed border-[#141414]/20 focus:outline-none resize-none cursor-pointer hover:bg-gray-100 transition-colors"
                placeholder="Typing..."
              />
              <AnimatePresence>
                {copyFeedback && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 flex items-center justify-center bg-blue-600/90 text-white font-bold rounded pointer-events-none"
                  >
                    복사됨! (Ctrl+V 하세요)
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={autoCopy} 
                  onChange={(e) => setAutoCopy(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-[10px] font-bold uppercase text-gray-500">Auto Copy</span>
              </label>
              <button 
                onClick={copyToClipboard}
                className="px-3 py-1 bg-[#141414] text-white text-[10px] font-bold uppercase rounded hover:bg-gray-800"
              >
                Manual Copy
              </button>
            </div>
          </div>
        </div>
      );
    }

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
                  <button 
                    onClick={() => setIsCompact(true)} 
                    className="px-2 py-1 bg-blue-600 text-white text-[10px] uppercase font-bold hover:bg-blue-700 transition-colors rounded"
                  >
                    미니 모드
                  </button>
                </div>
              </div>
              <div className="relative">
                <textarea 
                  value={getDisplayText()}
                  readOnly
                  placeholder="핸드폰에서 타이핑을 시작하세요..."
                  className="w-full h-[300px] p-6 text-2xl font-medium bg-gray-50 border border-dashed border-[#141414]/20 focus:outline-none resize-none leading-relaxed"
                />
                <AnimatePresence>
                  {copyFeedback && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="absolute top-4 right-4 bg-blue-600 text-white px-4 py-2 rounded-full font-bold shadow-lg flex items-center gap-2 z-10"
                    >
                      <Copy className="w-4 h-4" />
                      클립보드에 복사됨!
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              
              <div className="mt-4 flex items-center justify-between p-4 bg-blue-50 border border-blue-100 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Copy className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-blue-900">스마트 클립보드 브릿지</h4>
                    <p className="text-xs text-blue-700">핸드폰에서 입력이 끝나면 자동으로 노트북 클립보드에 저장됩니다.</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={autoCopy} 
                    onChange={(e) => setAutoCopy(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  <span className="ml-3 text-xs font-bold text-blue-900 uppercase tracking-widest">자동 복사</span>
                </label>
              </div>
              {/* Virtual Cursor */}
              <div 
                className="fixed w-4 h-4 bg-red-500 rounded-full pointer-events-none z-[9999] shadow-[0_0_10px_rgba(239,68,68,0.5)] transition-all duration-75"
                style={{ left: mousePos.x, top: mousePos.y, transform: 'translate(-50%, -50%)' }}
              />
            </div>

            {/* Desktop Integration Section */}
            <div className="bg-[#141414] text-white p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,0.2)]">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <Monitor className="w-6 h-6 text-blue-400" />
                  <h2 className="text-xl font-bold tracking-tight">다른 창에 직접 입력하기 (데스크탑 모드)</h2>
                </div>
                <button 
                  onClick={copyPythonCommand}
                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2"
                >
                  <Copy className="w-3 h-3" />
                  설치 명령어 복사
                </button>
              </div>
              
              <div className="grid md:grid-cols-2 gap-8">
                <div className="space-y-4 text-sm text-gray-400 font-serif italic">
                  <p className="text-blue-400 font-bold not-italic">가장 쉬운 방법:</p>
                  <ol className="list-decimal list-inside space-y-2">
                    <li>아래 <b>'도우미 파일 다운로드'</b>를 눌러 파일을 받으세요.</li>
                    <li>파일이 있는 폴더(예: 다운로드)에서 터미널을 엽니다.</li>
                    <li>위의 <b>'설치 명령어 복사'</b>를 누르고 터미널에 붙여넣으세요.</li>
                    <li>터미널에서 <code className="text-white bg-white/10 px-1">python cheonjiin_helper.py</code>가 실행되면 끝!</li>
                  </ol>
                  <div className="pt-4">
                    <button 
                      onClick={downloadHelper}
                      className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-700 transition-colors inline-flex items-center gap-2 not-italic"
                    >
                      <Download className="w-4 h-4" />
                      도우미 파일 다운로드 (.py)
                    </button>
                  </div>
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

  if (hasError) {
    return (
      <div className="min-h-screen bg-red-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-white p-8 rounded-2xl shadow-xl border border-red-200 max-w-sm">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Info className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">오류가 발생했습니다</h2>
          <p className="text-sm text-gray-600 mb-6">화면을 불러오는 중 문제가 발생했습니다. 아래 버튼을 눌러 다시 시도해 주세요.</p>
          <button 
            onClick={() => window.location.href = window.location.origin}
            className="w-full py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors"
          >
            처음으로 돌아가기
          </button>
          <div className="mt-4 text-[10px] text-gray-400 font-mono break-all">
            {errorInfo}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 min-h-screen h-screen-fix bg-[#F2F2F2] flex flex-col font-sans text-[#1c1d21] overflow-hidden select-none touch-none">
      {/* Header */}
      <div className="p-3 flex items-center justify-between bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`}></div>
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
            {roomId ? `ROOM: ${roomId}` : 'NO ROOM'}
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

      {!roomId ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-white">
          <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-6">
            <Smartphone className="w-10 h-10 text-gray-400" />
          </div>
          <h2 className="text-xl font-bold mb-2">연결 정보가 없습니다</h2>
          <p className="text-sm text-gray-500 mb-8">컴퓨터 화면의 코드를 입력하거나 QR 코드를 다시 찍어주세요.</p>
          <button 
            onClick={() => setMode('choice')}
            className="w-full py-4 bg-[#141414] text-white rounded-xl font-bold shadow-lg"
          >
            처음으로 돌아가기
          </button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeTab === 'keyboard' ? (
            <motion.div 
              key="keyboard"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 flex flex-col overflow-hidden"
            >
              {/* Preview */}
              <div className="flex-1 flex flex-col p-4 bg-white/50 overflow-hidden">
                <div className="flex-1 flex items-center justify-center overflow-y-auto">
                  <div className="text-center w-full">
                    <div className="text-3xl font-medium text-gray-800 break-all px-4">
                      {getDisplayText() || ' '}
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-blue-500 font-bold uppercase mt-2 text-center">
                  {inputMode === 'ko' ? '한글' : inputMode === 'en' ? 'English' : inputMode === 'num' ? '숫자' : '기호'}
                </div>
              </div>

            {/* Galaxy Style Keyboard - Dark Theme */}
            <div className="bg-black p-1 pb-6 shrink-0">
              {inputMode === 'sym' ? (
                <div className="flex flex-col gap-1">
                  {(symbolPage === 1 ? SYMBOL_LAYOUT_1 : SYMBOL_LAYOUT_2).map((row, rowIndex) => (
                    <div key={rowIndex} className="flex gap-1">
                      {row.map((key, keyIndex) => {
                        if (key === 'backspace') {
                          return (
                            <button 
                              key={key}
                              onMouseDown={(e) => startBackspace(e)}
                              onMouseUp={stopBackspace}
                              onMouseLeave={stopBackspace}
                              onTouchStart={(e) => startBackspace(e)}
                              onTouchEnd={stopBackspace}
                              className="w-[12%] h-10 bg-[#3A3A3C] rounded-md flex items-center justify-center active:bg-[#4A4A4C]"
                            >
                              <Delete className="w-5 h-5 text-white" />
                            </button>
                          );
                        }
                        if (key === 'ABC') {
                          return (
                            <button key={key} onClick={() => setInputMode('en')} className="w-[14%] h-10 bg-[#3A3A3C] rounded-md flex items-center justify-center text-white text-xs font-bold">ABC</button>
                          );
                        }
                        if (key === 'mode') {
                          return (
                            <button key={key} onClick={() => handleKeyClick('mode')} className="w-[14%] h-10 bg-[#3A3A3C] rounded-md flex flex-col items-center justify-center text-white text-[8px] font-bold leading-tight">
                              <span>한</span>
                              <div className="w-3 h-[1px] bg-white/30 my-0.5 rotate-[-45deg]"></div>
                              <span className="ml-1.5">영</span>
                            </button>
                          );
                        }
                        if (key === 'space') {
                          return (
                            <button key={key} onClick={() => handleKeyClick('space')} className="flex-1 h-10 bg-[#2C2C2E] rounded-md flex items-center justify-center">
                              <div className="w-16 h-1 bg-white/20 rounded-full"></div>
                            </button>
                          );
                        }
                        if (key === 'enter') {
                          return (
                            <button key={key} onClick={() => handleKeyClick('enter')} className="w-[14%] h-10 bg-[#3A3A3C] rounded-md flex items-center justify-center">
                              <CornerDownLeft className="w-5 h-5 text-white" />
                            </button>
                          );
                        }
                        if (key === '1/2') {
                          return (
                            <button key={key} onClick={() => setSymbolPage(2)} className="w-[12%] h-10 bg-[#3A3A3C] rounded-md flex items-center justify-center text-white text-xs font-bold">1/2</button>
                          );
                        }
                        if (key === '2/2') {
                          return (
                            <button key={key} onClick={() => setSymbolPage(1)} className="w-[12%] h-10 bg-[#3A3A3C] rounded-md flex items-center justify-center text-white text-xs font-bold">2/2</button>
                          );
                        }
                        return (
                          <button
                            key={keyIndex}
                            onClick={() => handleKeyClick(key)}
                            className={`flex-1 h-10 bg-[#2C2C2E] rounded-md flex items-center justify-center text-white text-base font-medium active:bg-[#3A3A3C]`}
                          >
                            {key}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ) : inputMode === 'en' ? (
                <div className="flex flex-col gap-1.5">
                  {/* Row 1: Numbers */}
                  <div className="flex gap-1">
                    {['1','2','3','4','5','6','7','8','9','0'].map(k => (
                      <button key={k} onClick={() => handleKeyClick(k)} className="flex-1 h-10 bg-[#2C2C2E] rounded-md flex items-center justify-center text-white text-base font-medium active:bg-[#3A3A3C]">{k}</button>
                    ))}
                  </div>
                  {/* Row 2: QWERTY */}
                  <div className="flex gap-1">
                    {['q','w','e','r','t','y','u','i','o','p'].map(k => (
                      <button key={k} onClick={() => handleKeyClick(k)} className="flex-1 h-10 bg-[#2C2C2E] rounded-md flex items-center justify-center text-white text-base font-medium uppercase active:bg-[#3A3A3C]">{k}</button>
                    ))}
                  </div>
                  {/* Row 3: ASDF */}
                  <div className="flex gap-1 px-[5%]">
                    {['a','s','d','f','g','h','j','k','l'].map(k => (
                      <button key={k} onClick={() => handleKeyClick(k)} className="flex-1 h-10 bg-[#2C2C2E] rounded-md flex items-center justify-center text-white text-base font-medium uppercase active:bg-[#3A3A3C]">{k}</button>
                    ))}
                  </div>
                  {/* Row 4: Shift, ZXCV, Backspace */}
                  <div className="flex gap-1">
                    <button onClick={() => handleKeyClick('shift')} className={`w-[13%] h-10 rounded-md flex items-center justify-center transition-colors ${shiftState === 2 ? 'bg-white text-blue-600' : shiftState === 1 ? 'bg-white text-black' : 'bg-[#3A3A3C] text-white'}`}>
                      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
                        <path d="M12 4l-8 8h5v8h6v-8h5z"/>
                        {shiftState === 2 && <rect x="4" y="2" width="16" height="2" />}
                      </svg>
                    </button>
                    <div className="flex-1 flex gap-1">
                      {['z','x','c','v','b','n','m'].map(k => (
                        <button key={k} onClick={() => handleKeyClick(k)} className="flex-1 h-10 bg-[#2C2C2E] rounded-md flex items-center justify-center text-white text-base font-medium uppercase active:bg-[#3A3A3C]">{k}</button>
                      ))}
                    </div>
                    <button 
                      onMouseDown={(e) => startBackspace(e)}
                      onMouseUp={stopBackspace}
                      onMouseLeave={stopBackspace}
                      onTouchStart={(e) => startBackspace(e)}
                      onTouchEnd={stopBackspace}
                      className="w-[13%] h-10 bg-[#3A3A3C] rounded-md flex items-center justify-center active:bg-[#4A4A4C]"
                    >
                      <Delete className="w-5 h-5 text-white" />
                    </button>
                  </div>
                  {/* Row 5: Bottom Bar */}
                  <div className="flex gap-1">
                    <button onClick={() => setInputMode('sym')} className="w-[14%] h-10 bg-[#3A3A3C] rounded-md flex items-center justify-center text-white text-xs font-bold">!#1</button>
                    <button onClick={() => handleKeyClick('mode')} className="w-[14%] h-10 bg-[#3A3A3C] rounded-md flex flex-col items-center justify-center text-white text-[8px] font-bold leading-tight">
                      <span>한</span>
                      <div className="w-3 h-[1px] bg-white/30 my-0.5 rotate-[-45deg]"></div>
                      <span className="ml-1.5">영</span>
                    </button>
                    <button onClick={() => handleKeyClick(',')} className="w-[10%] h-10 bg-[#2C2C2E] rounded-md flex items-center justify-center text-white text-lg font-bold">,</button>
                    <button onClick={() => handleKeyClick('space')} className="flex-1 h-10 bg-[#2C2C2E] rounded-md flex items-center justify-center">
                      <div className="w-16 h-1 bg-white/20 rounded-full"></div>
                    </button>
                    <button onClick={() => handleKeyClick('.')} className="w-[10%] h-10 bg-[#2C2C2E] rounded-md flex items-center justify-center text-white text-lg font-bold">.</button>
                    <button onClick={() => handleKeyClick('enter')} className="w-[14%] h-10 bg-[#3A3A3C] rounded-md flex items-center justify-center">
                      <CornerDownLeft className="w-5 h-5 text-white" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {/* Row 1 */}
                  <div className="grid grid-cols-4 gap-1.5">
                    {[KEYPAD_CONFIG[0], KEYPAD_CONFIG[1], KEYPAD_CONFIG[2]].map(key => (
                      <button
                        key={key.id}
                        onClick={() => handleKeyClick(key.id)}
                        className="h-16 bg-[#2C2C2E] rounded-xl shadow-sm flex flex-col items-center justify-center active:bg-[#3A3A3C] transition-all active:scale-95 relative overflow-hidden"
                      >
                        <span className="absolute top-1 right-2 text-[10px] font-bold text-[#8E8E93]">{key.id}</span>
                        <span className="text-xl font-bold text-white">{key.label}</span>
                      </button>
                    ))}
                    <button 
                      onMouseDown={(e) => startBackspace(e)}
                      onMouseUp={stopBackspace}
                      onMouseLeave={stopBackspace}
                      onTouchStart={(e) => startBackspace(e)}
                      onTouchEnd={stopBackspace}
                      className="h-16 bg-[#3A3A3C] rounded-xl shadow-sm flex items-center justify-center active:bg-[#4A4A4C] active:scale-95 transition-all"
                    >
                      <Delete className="w-6 h-6 text-white" />
                    </button>
                  </div>

                  {/* Row 2 */}
                  <div className="grid grid-cols-4 gap-1.5">
                    {[KEYPAD_CONFIG[3], KEYPAD_CONFIG[4], KEYPAD_CONFIG[5]].map(key => (
                      <button
                        key={key.id}
                        onClick={() => handleKeyClick(key.id)}
                        className="h-16 bg-[#2C2C2E] rounded-xl shadow-sm flex flex-col items-center justify-center active:bg-[#3A3A3C] transition-all active:scale-95 relative overflow-hidden"
                      >
                        <span className="absolute top-1 right-2 text-[10px] font-bold text-[#8E8E93]">{key.id}</span>
                        <span className="text-xl font-bold text-white">{key.label}</span>
                      </button>
                    ))}
                    <button 
                      onClick={() => handleKeyClick('enter')}
                      className="h-16 bg-[#3A3A3C] rounded-xl shadow-sm flex items-center justify-center active:bg-[#4A4A4C] active:scale-95 transition-all"
                    >
                      <CornerDownLeft className="w-6 h-6 text-white" />
                    </button>
                  </div>

                  {/* Row 3 */}
                  <div className="grid grid-cols-4 gap-1.5">
                    {[KEYPAD_CONFIG[6], KEYPAD_CONFIG[7], KEYPAD_CONFIG[8]].map(key => (
                      <button
                        key={key.id}
                        onClick={() => handleKeyClick(key.id)}
                        className="h-16 bg-[#2C2C2E] rounded-xl shadow-sm flex flex-col items-center justify-center active:bg-[#3A3A3C] transition-all active:scale-95 relative overflow-hidden"
                      >
                        <span className="absolute top-1 right-2 text-[10px] font-bold text-[#8E8E93]">{key.id}</span>
                        <span className="text-xl font-bold text-white">{key.label}</span>
                      </button>
                    ))}
                    <button 
                      onClick={() => handleKeyClick('punct')}
                      className="h-16 bg-[#2C2C2E] rounded-xl shadow-sm flex items-center justify-center active:bg-[#3A3A3C] active:scale-95 transition-all text-xl font-bold text-white"
                    >
                      .,?!
                    </button>
                  </div>

                  {/* Row 4 */}
                  <div className="grid grid-cols-4 gap-1.5 h-16">
                    <div className="flex gap-1">
                      <button 
                        onClick={() => setInputMode('sym')}
                        className="flex-1 bg-[#3A3A3C] rounded-xl shadow-sm flex items-center justify-center text-sm font-bold text-white active:bg-[#4A4A4C] transition-all active:scale-95"
                      >
                        !#1
                      </button>
                      <button 
                        onClick={() => handleKeyClick('mode')}
                        className="flex-1 bg-[#3A3A3C] rounded-xl shadow-sm flex flex-col items-center justify-center text-[8px] font-bold text-white active:bg-[#4A4A4C] transition-all active:scale-95 leading-tight"
                      >
                        <span>한</span>
                        <div className="w-3 h-[1px] bg-white/30 my-0.5 rotate-[-45deg]"></div>
                        <span className="ml-1">영</span>
                      </button>
                    </div>
                    <button 
                      onClick={() => handleKeyClick('0')}
                      className="bg-[#2C2C2E] rounded-xl shadow-sm flex flex-col items-center justify-center active:bg-[#3A3A3C] transition-all active:scale-95 relative overflow-hidden"
                    >
                      <span className="absolute top-1 right-2 text-[10px] font-bold text-[#8E8E93]">0</span>
                      <span className="text-xl font-bold text-white">ㅇㅁ</span>
                    </button>
                    <button 
                      onClick={() => handleKeyClick('space')}
                      className="bg-[#2C2C2E] rounded-xl shadow-sm flex items-center justify-center active:bg-[#3A3A3C] active:scale-95 transition-all"
                    >
                      <div className="w-10 h-1 bg-white/20 rounded-full"></div>
                    </button>
                    <button 
                      onClick={() => sendCommand('clear')}
                      className="bg-[#3A3A3C] rounded-xl shadow-sm flex items-center justify-center text-xs font-bold text-white active:bg-[#4A4A4C] transition-all active:scale-95"
                    >
                      한자
                    </button>
                  </div>
                </div>
              )}
            </div>
            </motion.div>
          ) : (
            <motion.div 
              key="mouse"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 flex flex-col p-4 gap-4 overflow-hidden"
            >
              {/* Sensitivity & Air Mouse Controls */}
              <div className="flex items-center justify-between bg-white p-3 rounded-2xl border border-gray-200 shadow-sm shrink-0">
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
              
              <p className="text-[10px] text-center text-gray-400 italic shrink-0">
                {isAirMouseActive ? "핸드폰을 기울여서 마우스를 움직이세요" : "트랙패드를 문질러서 마우스를 움직이세요"}
              </p>
            </motion.div>
          )}
        </div>
      )}

      {/* Bottom Bar */}
      <div className="h-1.5 w-20 bg-gray-300 mx-auto mb-3 rounded-full shrink-0"></div>
    </div>
  );
}
