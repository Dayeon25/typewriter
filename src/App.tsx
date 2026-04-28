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
  Download,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as Hangul from 'hangul-js';
import ReactDOM from 'react-dom';
import { db } from './firebase';
import firebaseConfig from '../firebase-applet-config.json';
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
  const [mobileCopyFeedback, setMobileCopyFeedback] = useState(false);

  const [lastSentComposition, setLastSentComposition] = useState<string>('');

  const [lastSentDisplay, setLastSentDisplay] = useState('');
  const lastQueuedText = useRef('');
  const [lastSentTimestamp, setLastSentTimestamp] = useState(0);

  const [lastChar, setLastChar] = useState<string | null>(null);
  const [tapCount, setTapCount] = useState(0);
  const tapTimer = useRef<NodeJS.Timeout | null>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const backspaceInterval = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [hasError, setHasError] = useState(false);
  const [errorInfo, setErrorInfo] = useState<string>('');
  const [shiftState, setShiftState] = useState<0 | 1 | 2>(0); // 0: off, 1: once, 2: locked
  const [pipWindow, setPipWindow] = useState<any>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  
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
    const q = query(eventsRef, where('timestamp', '>', lastProcessedTimestamp), orderBy('timestamp', 'asc'), orderBy('seq', 'asc'), limit(20));
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
      let nextCommittedText = committedText;
      let nextComposition = composition;

      if (isCommand) {
        if (input === 'backspace') {
          if (composition.length > 0) {
            nextComposition = composition.slice(0, -1);
          } else {
            nextCommittedText = committedText.slice(0, -1);
          }
        } else if (input === 'clear') {
          nextCommittedText = '';
          nextComposition = [];
        } else if (input === 'enter') {
          const processed = processCheonjiin(composition);
          const assembled = Hangul.assemble(processed);
          nextCommittedText = committedText + (assembled || processed.join('')) + '\n';
          nextComposition = [];
        } else if (input === 'space') {
          const processed = processCheonjiin(composition);
          const assembled = Hangul.assemble(processed);
          nextCommittedText = committedText + (assembled || processed.join('')) + ' ';
          nextComposition = [];
        }
      } else {
        // Handle character input
        const isKorean = /[ㄱ-ㅎㅏ-ㅣㆍ]/.test(input);
        if (isKorean) {
          nextComposition = [...composition, input];
        } else {
          const processed = processCheonjiin(composition);
          const assembled = Hangul.assemble(processed);
          nextCommittedText = committedText + (assembled || processed.join('')) + input;
          nextComposition = [];
        }
      }

      // Sync to Receiver (Laptop) optimized in a separate useEffect to handle batching and prevent duplication
      return { committedText: nextCommittedText, composition: nextComposition };
    });
  };

  // Improved sync effect that calculates diff and sends events
  useEffect(() => {
    if (mode !== 'sender' || !roomId || !isConnected) return;

    const currentAssembled = Hangul.assemble(processCheonjiin(inputState.composition)) || processCheonjiin(inputState.composition).join('');
    const currentFullText = inputState.committedText + currentAssembled;

    if (currentFullText === lastQueuedText.current) return;

    // Cache current text to prevent duplicate triggers during debounce
    const targetText = currentFullText;

    const timeout = setTimeout(() => {
      const oldText = lastQueuedText.current;
      const newText = targetText;

      if (oldText === newText) return;

      // Find common prefix
      let commonLen = 0;
      const minLen = Math.min(oldText.length, newText.length);
      while (commonLen < minLen && oldText[commonLen] === newText[commonLen]) {
        commonLen++;
      }

      const backspaces = oldText.length - commonLen;
      const t = Date.now();

      if (backspaces > 0 || commonLen < newText.length) {
        lastQueuedText.current = newText;
        emitEvent('sync-text', {
          deleteCount: backspaces,
          insertText: newText.substring(commonLen),
          ts: t
        });
        setLastSentDisplay(newText);
      }
    }, 500); // Increased debounce to save more quota

    return () => clearTimeout(timeout);
  }, [inputState, mode, roomId, isConnected]);

  const handleInputRef = useRef(handleInput);
  handleInputRef.current = handleInput;

  // Sync state to Firestore (Sender -> Receiver) - Debounced for quota
  useEffect(() => {
    if (mode === 'sender' && roomId && isConnected) {
      const timeout = setTimeout(() => {
        const roomRef = doc(db, 'rooms', roomId);
        updateDoc(roomRef, {
          inputState: inputState,
          lastUpdate: serverTimestamp()
        }).catch(err => console.error("Sync error:", err));
      }, 3000); // Sync full state every 3 seconds to save quota
      return () => clearTimeout(timeout);
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

  // Air Mouse (Gyroscope) Logic
  useEffect(() => {
    if (!isAirMouseActive || activeTab !== 'mouse' || !roomId) return;

    let lastX = 0;
    let lastY = 0;
    let lastTime = Date.now();

    const handleOrientation = (e: DeviceOrientationEvent) => {
      const now = Date.now();
      if (now - lastTime < 250) return; // Throttled to 4/sec to save quota

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

  const lastClickTime = useRef(0);
  const handleKeyClick = (keyId: string, isLongPress: boolean = false) => {
    if (!roomId) return;

    if (isLongPress && ['1','2','3','4','5','6','7','8','9','0'].includes(keyId)) {
      handleInput(keyId);
      return;
    }

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
      handleInput('backspace', true);
      setLastChar(null);
      setTapCount(0);
      return;
    }

    if (keyId === 'enter') {
      handleInput('enter', true);
      setLastChar(null);
      setTapCount(0);
      return;
    }

    if (keyId === 'space') {
      handleInput('space', true);
      setLastChar(null);
      setTapCount(0);
      return;
    }

    if (inputMode === 'sym') {
      handleInput(keyId);
      return;
    }

    if (inputMode === 'en' && keyId.length === 1) {
      // Long press check for alphabet keys in QWERTY
      if (isLongPress) {
        const numMap: Record<string, string> = {
          'q': '1', 'w': '2', 'e': '3', 'r': '4', 't': '5', 'y': '6', 'u': '7', 'i': '8', 'o': '9', 'p': '0'
        };
        if (numMap[keyId]) {
          handleInput(numMap[keyId]);
          return;
        }
      }
      
      let char = keyId;
      if (shiftState > 0) {
        char = char.toUpperCase();
      } else {
        char = char.toLowerCase();
      }
      handleInput(char);
      if (shiftState === 1) setShiftState(0); 
      return;
    }

    const config = KEYPAD_CONFIG.find(k => k.id === keyId);
    if (!config) return;

    if (isLongPress && config.num[0]) {
      handleInput(config.num[0]);
      return;
    }

    const chars = config[inputMode === 'sym' ? 'num' : inputMode];
    const isVowel = inputMode === 'ko' && ['1', '2', '3'].includes(keyId);

    if (lastChar === keyId && !isVowel && inputMode !== 'num') {
      // Multi-tap
      handleInput('backspace', true);
      
      const nextTap = (tapCount + 1) % chars.length;
      setTapCount(nextTap);
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
        if (e.cancelable) e.preventDefault();
      }
    }
    if (backspaceInterval.current) return;
    
    // Immediate initial backspace
    handleInput('backspace', true);
    setLastChar(null);
    setTapCount(0);
    
    // repeat after delay
    backspaceInterval.current = setInterval(() => {
      handleInput('backspace', true);
    }, 150); // Faster repeat for better feel
  };

  const stopBackspace = () => {
    if (backspaceInterval.current) {
      clearInterval(backspaceInterval.current);
      backspaceInterval.current = null;
    }
  };

  const handleKeyPressStart = (keyId: string) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    
    // Set a timer for long press (600ms)
    longPressTimer.current = setTimeout(() => {
      handleKeyClick(keyId, true);
      longPressTimer.current = null;
    }, 600);
  };

  const handleKeyPressEnd = (keyId: string, wasLongPress: boolean = false) => {
    if (longPressTimer.current) {
      // It was a short click
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
      handleKeyClick(keyId, false);
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
    const cmd = `python -m pip install pyautogui requests pyperclip; python cheonjiin_helper.py`;
    navigator.clipboard.writeText(cmd).then(() => {
      addLog('Command copied!');
    });
  };

  const getPythonScript = () => `
import sys
import requests
import time
import pyautogui
import pyperclip
import json

# 최적화된 마우스/키보드 설정
pyautogui.PAUSE = 0.005
pyautogui.FAILSAFE = True

# 글로벌 변수 설정
PROJECT_ID = "${firebaseConfig.projectId}"
DATABASE_ID = "${firebaseConfig.firestoreDatabaseId || 'default'}"
API_KEY = "${firebaseConfig.apiKey}"

def process_event(event_data):
    etype = event_data.get('type')
    edata = event_data.get('data', {})
    
    if etype == 'sync-text':
        delete_count = edata.get('deleteCount', 0)
        insert_text = edata.get('insertText', '')
        
        # 1. 삭제 작업 수행
        if delete_count > 0:
            print(f" [-] 삭제: {delete_count}글자")
            for _ in range(delete_count):
                pyautogui.press('backspace', _pause=False)
            time.sleep(0.005)
        
        # 2. 입력 작업 수행 (클립보드 방식이 가장 정확합니다)
        if insert_text:
            print(f" [+] 입력: {insert_text}")
            pyperclip.copy(insert_text)
            time.sleep(0.01)
            if sys.platform == 'darwin':
                pyautogui.hotkey('command', 'v')
            else:
                pyautogui.hotkey('ctrl', 'v')
            time.sleep(0.005)
                
    elif etype == 'command':
        cmd = edata.get('cmd')
        if cmd == 'backspace': pyautogui.press('backspace', _pause=False)
        elif cmd == 'enter': pyautogui.press('enter')
        elif cmd == 'space': pyautogui.press('space')
        elif cmd == 'clear':
            if sys.platform == 'darwin': pyautogui.hotkey('command', 'a')
            else: pyautogui.hotkey('ctrl', 'a')
            pyautogui.press('backspace')
            print(" [!] 입력창 초기화")
            
    elif etype == 'mouse-move':
        dx, dy = edata.get('dx', 0), edata.get('dy', 0)
        pyautogui.moveRel(dx * 2.0, dy * 2.0, duration=0.01)
        
    elif etype == 'mouse-click':
        btn = edata.get('button', 'left')
        pyautogui.click(button=btn)

def run_helper(room_id):
    print(f"\n[+] Monitoring Room: {room_id}")
    last_processed_timestamp = int(time.time() * 1000)
    session = requests.Session()
    first_run = True
    
    query_body = {
        "structuredQuery": {
            "from": [{"collectionId": "events"}],
            "where": {
                "fieldFilter": {
                    "field": {"fieldPath": "timestamp"},
                    "op": "GREATER_THAN",
                    "value": {"integerValue": last_processed_timestamp}
                }
            },
            "orderBy": [{"field": {"fieldPath": "timestamp"}, "direction": "ASCENDING"}],
            "limit": 10
        }
    }

    try:
        while True:
            query_body["structuredQuery"]["where"]["fieldFilter"]["value"]["integerValue"] = last_processed_timestamp
            parent_path = f"projects/{PROJECT_ID}/databases/{DATABASE_ID}/documents/rooms/{room_id}"
            
            response = session.post(
                f"https://firestore.googleapis.com/v1/{parent_path}:runQuery?key={API_KEY}", 
                json=query_body,
                timeout=5
            )
            
            if response.status_code == 200:
                results = response.json()
                if not results or (len(results) == 1 and 'document' not in results[0]):
                    pass
                else:
                    for res in results:
                        doc = res.get('document')
                        if not doc: continue
                        fields = doc.get('fields', {})
                        ts = int(fields.get('timestamp', {}).get('integerValue', 0))
                        if ts > last_processed_timestamp:
                            last_processed_timestamp = ts
                            if not first_run:
                                try:
                                    event_data = {"type": fields.get('type', {}).get('stringValue'), "data": {}}
                                    raw_data = fields.get('data', {}).get('mapValue', {}).get('fields', {})
                                    for k, v in raw_data.items():
                                        if 'stringValue' in v: event_data['data'][k] = v['stringValue']
                                        elif 'integerValue' in v: event_data['data'][k] = int(v['integerValue'])
                                        elif 'doubleValue' in v: event_data['data'][k] = float(v['doubleValue'])
                                    process_event(event_data)
                                except Exception as e:
                                    print(f"Error processing event: {e}")
                first_run = False
            elif response.status_code == 404:
                print(f"\n[!] 룸 {room_id}를 찾을 수 없습니다. (핸드폰이 꺼져있거나 코드가 틀림)")
                return False
            
            time.sleep(1.0) # Optimized polling to save Firestore quota
    except KeyboardInterrupt:
        print("\\n[!] 사용자에 의해 정지되었습니다.")
        return True

if __name__ == "__main__":
    print("--------------------------------------------------")
    print("스마트 리모트 키보드 도우미 (v3.0 - Pro)")
    print("--------------------------------------------------")
    
    current_room = '${roomId}' if '${roomId}' else None
    
    while True:
        if not current_room:
            current_room = input("\\n[?] 연결할 룸 코드를 입력하세요 (예: ABCDEF): ").strip().upper()
        
        if not current_room: continue
        
        success = run_helper(current_room)
        if success: # Manual stop
            break
        
        # Room not found or error, ask for new code
        current_room = None
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

  const resetApp = () => {
    if (pipWindow) {
      pipWindow.close();
      setPipWindow(null);
    }
    setMode('choice');
    setRoomId('');
    setIsConnected(false);
    setIsCompact(false);
    window.history.pushState({}, '', window.location.origin + window.location.pathname);
  };

  if (mode === 'choice') {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex flex-col items-center justify-center p-6 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white border border-[#141414] p-8 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)]"
        >
          <h1 className="text-3xl font-bold mb-2 tracking-tight text-[#141414]">스마트 리모트 키보드</h1>
          <p className="text-sm text-gray-600 mb-8 italic font-serif">Smart Remote Keyboard</p>
          
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

  const togglePip = async () => {
    // Check if we are in an iframe
    const isInIframe = () => {
      try {
        return window.self !== window.top;
      } catch (e) {
        return true;
      }
    };

    if ('documentPictureInPicture' in window) {
      if (isInIframe()) {
        const confirmNewTab = window.confirm(
          'PICTURE-IN-PICTURE (미니 모드) 알림:\n\n' +
          '현재 미리보기 탭(iframe)에서는 미니 모드를 시작할 수 없습니다. ' +
          '브라우저 보안 정책상 상단 바의 "Open in New Tab" 버튼을 눌러 새 창에서 실행해야 합니다.\n\n' +
          '새 탭에서 창을 여시겠습니까?'
        );
        if (confirmNewTab) {
          window.open(window.location.href, '_blank');
        }
        return;
      }

      try {
        // @ts-ignore
        const pipWindow = await window.documentPictureInPicture.requestWindow({
          width: 360,
          height: 480,
        });

        const pipDiv = document.createElement('div');
        pipDiv.id = 'pip-root';
        pipWindow.document.body.append(pipDiv);

        // Copy styles
        [...document.styleSheets].forEach((styleSheet) => {
          try {
            const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
            const style = document.createElement('style');
            style.textContent = cssRules;
            pipWindow.document.head.appendChild(style);
          } catch (e) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = (styleSheet as any).href;
            pipWindow.document.head.appendChild(link);
          }
        });

        // Add a class to indicate PiP mode if needed
        pipWindow.document.body.classList.add('bg-[#E4E3E0]');

        setPipWindow(pipWindow);
        setIsCompact(true);

        pipWindow.addEventListener('pagehide', () => {
          setPipWindow(null);
          setIsCompact(false);
        });
      } catch (err: any) {
        console.error('PiP failed', err);
        if (err.name === 'NotAllowedError') {
          alert('브라우저에서 창 열기 권한이 거부되었습니다.');
        } else if (err.message?.includes('browsing context')) {
          alert('이 환경(iframe)에서는 미니 모드를 지원하지 않습니다. 새 탭에서 열어주세요.');
        } else {
          alert('미니 모드 실행 중 오류가 발생했습니다: ' + (err.message || '알 수 없는 오류'));
        }
        setIsCompact(false);
      }
    } else {
      alert('사용 중인 브라우저가 Document Picture-in-Picture API를 지원하지 않습니다. (최신 Chrome 필요)');
      setIsCompact(true);
    }
  };

  if (mode === 'receiver') {
    const getBaseUrl = () => {
      const url = new URL(window.location.href);
      return url.origin + url.pathname;
    };
    const shareUrl = `${getBaseUrl()}?mode=sender&room=${roomId}`;
    const pythonScript = getPythonScript();

    // Render Compact UI (for normal floating or PiP)
    const renderCompactUI = () => (
      <div className={`${pipWindow ? 'w-full h-full p-0' : 'fixed bottom-4 right-4 w-80 z-[10000] border-2 border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]'} bg-white flex flex-col overflow-hidden rounded-xl`}>
        <div className="bg-[#141414] text-white p-3 flex items-center justify-between cursor-move">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-red-500 animate-pulse'}`}></div>
            <span className="text-[10px] font-black uppercase tracking-tighter">리모트 키보드</span>
            <span className="text-[10px] opacity-40 font-mono">[{roomId}]</span>
          </div>
          <div className="flex gap-2">
            {!pipWindow && (
              <button onClick={() => setIsCompact(false)} className="p-1 hover:bg-white/20 rounded">
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
            {pipWindow && (
              <button 
                onClick={() => pipWindow.close()} 
                className="p-1.5 hover:bg-red-500 rounded bg-white/10 transition-colors"
                title="창 닫기"
              >
                <CornerDownLeft className="w-3 h-3" />
              </button>
            )}
            <button 
              onClick={resetApp} 
              className="p-1.5 hover:bg-red-600 rounded bg-white/10 transition-colors"
              title="홈으로"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
        </div>
        <div className="p-4 space-y-3 flex-1 flex flex-col bg-gray-50">
          <div className="relative flex-1">
            <textarea 
              value={getDisplayText()}
              readOnly
              onClick={copyToClipboard}
              className="w-full h-full min-h-[180px] p-4 text-xl font-medium bg-white border-2 border-[#141414]/10 rounded-xl focus:outline-none resize-none cursor-pointer hover:border-blue-500 transition-all font-sans leading-relaxed"
              placeholder="내용 입력 중..."
            />
            <AnimatePresence>
              {copyFeedback && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex items-center justify-center bg-blue-600/95 text-white font-black rounded-xl pointer-events-none text-center p-2 uppercase tracking-widest text-sm"
                >
                  복사됨!<br/><span className="text-[10px] opacity-70">이제 다른 곳에 붙여넣으세요 (Ctrl+V)</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 cursor-pointer group">
              <input 
                type="checkbox" 
                checked={autoCopy} 
                onChange={(e) => setAutoCopy(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-[10px] font-black uppercase text-gray-400 group-hover:text-gray-900 transition-colors">클립보드 자동 복사</span>
            </label>
            <button 
              onClick={copyToClipboard}
              className="px-4 py-1.5 bg-[#141414] text-white text-[10px] font-black uppercase rounded-lg hover:bg-blue-600 transition-all active:scale-95 shadow-md"
            >
              수동 복사
            </button>
          </div>
        </div>
      </div>
    );

    if (pipWindow) {
      const pipRoot = pipWindow.document.getElementById('pip-root');
      return (
        <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center p-12">
          <div className="text-center space-y-4">
            <motion.div 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="w-20 h-20 bg-blue-600 text-white rounded-full flex items-center justify-center mx-auto shadow-xl"
            >
              <Monitor className="w-10 h-10" />
            </motion.div>
            <h2 className="text-3xl font-bold tracking-tight">화면이 분리되었습니다</h2>
            <p className="text-gray-500 font-serif italic text-lg">노트북 화면 구석에 작은 창이 떠 있을 거예요!</p>
            <div className="pt-8 flex flex-col gap-3">
            <button onClick={() => pipWindow.close()} className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg hover:bg-blue-700 transition-all active:scale-95 flex items-center justify-center gap-2 mx-auto w-full max-w-xs">
              <Monitor className="w-5 h-5" />
              메인 화면으로 합치기
            </button>
            <button onClick={resetApp} className="px-8 py-3 bg-[#141414] text-white rounded-xl font-bold shadow-lg hover:bg-gray-800 transition-all active:scale-95 flex items-center justify-center gap-2 mx-auto w-full max-w-xs">
              <RefreshCw className="w-5 h-5" />
              초기화면 및 홈으로
            </button>
          </div>
          </div>
          {pipRoot && ReactDOM.createPortal(renderCompactUI(), pipRoot)}
        </div>
      );
    }

    if (isCompact) {
      return renderCompactUI();
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
                    {isConnected ? `실시간 연결: ${roomId}` : connectionError ? `오류: ${connectionError}` : '연결 시도 중...'}
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
                    onClick={resetApp}
                    className="px-2 py-1 bg-red-600 text-white text-[10px] uppercase font-bold hover:bg-red-700 transition-colors rounded flex items-center gap-1"
                  >
                    <CornerDownLeft className="w-3 h-3" />
                    초기화면
                  </button>
                  <button 
                    onClick={togglePip} 
                    className="px-2 py-1 bg-blue-600 text-white text-[10px] uppercase font-bold hover:bg-blue-700 transition-colors rounded flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    미니 모드 (PiP)
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
                    <li><a href="https://www.python.org/downloads/" target="_blank" rel="noreferrer" className="underline text-blue-300">Python</a>이 설치되어 있어야 합니다.</li>
                    <li>아래 <b>'도우미 파일 다운로드'</b>를 눌러 파일을 받으세요.</li>
                    <li>파일이 있는 폴더에서 터미널을 엽니다.</li>
                    <li>위의 <b>'설치 명령어 복사'</b>를 누르고 터미널에 붙여넣으세요.</li>
                    <li>이제 룸번호가 바뀌어도 터미널에서 <b>직접 입력</b>해 연결할 수 있습니다!</li>
                    <li className="text-xs text-gray-500">팁: 카카오톡 잠금화면 등에서는 숫자 패드를 직접 클릭하거나 핸드폰의 숫자 모드로 입력하세요.</li>
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
      
      // Throttle mouse moves to 20ms for better responsiveness
      if (now - lastMouseMoveTime.current > 20) {
        emitEvent('mouse-move', { dx: dx * mouseSensitivity, dy: dy * mouseSensitivity });
        lastMouseMoveTime.current = now;
      }
    }
    mouseRef.current = { x: touch.clientX, y: touch.clientY };
  };

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
          <button onClick={resetApp} className="p-2 text-gray-400">
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
            onClick={resetApp}
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
              <div className="flex-1 flex flex-col p-4 bg-gray-50/80 overflow-hidden relative">
                <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-yellow-50 border border-yellow-200 rounded text-[8px] font-bold text-yellow-700">
                    <svg viewBox="0 0 24 24" className="w-3 h-3 fill-none stroke-current stroke-2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                    <span>무료 서버 할당량 보호 중 (동기화 지연 발생 가능)</span>
                  </div>
                </div>
                <div className="absolute top-2 right-2 flex flex-col gap-1 z-10 items-center">
                  <span className="text-[8px] font-bold text-gray-400 rotate-0 uppercase">키보드 높이</span>
                  <button 
                    onClick={() => setKeyboardOffset(prev => Math.max(prev - 20, -200))}
                    className="w-8 h-8 bg-black/5 text-gray-400 rounded-full flex items-center justify-center active:bg-black/10"
                    title="올리기"
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current stroke-2"><path d="m18 15-6-6-6 6"/></svg>
                  </button>
                  <button 
                    onClick={() => setKeyboardOffset(prev => Math.min(prev + 20, 200))}
                    className="w-8 h-8 bg-black/5 text-gray-400 rounded-full flex items-center justify-center active:bg-black/10"
                    title="내리기"
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current stroke-2"><path d="m6 9 6 6 6-6"/></svg>
                  </button>
                  <button 
                    onClick={() => setKeyboardOffset(0)}
                    className="w-8 h-8 bg-black/5 text-[8px] font-bold text-gray-400 rounded-full flex items-center justify-center active:bg-black/10"
                  >
                    초기화
                  </button>

                  <button 
                    onClick={() => {
                      const text = getDisplayText();
                      if (text) {
                        navigator.clipboard.writeText(text);
                        setMobileCopyFeedback(true);
                        setTimeout(() => setMobileCopyFeedback(false), 1500);
                      }
                    }}
                    className="w-8 h-8 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center active:bg-blue-100 mt-2 relative"
                    title="복사하기"
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-none stroke-current stroke-2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2"/></svg>
                    <AnimatePresence>
                      {mobileCopyFeedback && (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.5, x: 20 }}
                          animate={{ opacity: 1, scale: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.5, x: 20 }}
                          className="absolute right-full mr-2 bg-gray-800 text-white text-[8px] font-bold py-1 px-2 rounded whitespace-nowrap"
                        >
                          복사됨!
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </button>
                </div>

                <div className="flex-1 flex items-center justify-center overflow-y-auto">
                  <div className="text-center w-full">
                    <div className="text-3xl font-semibold text-gray-800 break-all px-4">
                      {getDisplayText() || ' '}
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-blue-500 font-bold uppercase mt-2 text-center tracking-widest">
                  {inputMode === 'ko' ? '한글 입력' : inputMode === 'en' ? '영어 입력' : inputMode === 'num' ? '숫자 입력' : '기호 입력'}
                </div>
              </div>

            {/* Galaxy Style Keyboard - Clean Theme with Accents */}
            <div 
              className="bg-[#F2F2F7] p-1.5 pb-8 shrink-0 transition-transform duration-200 ease-out border-t border-gray-200/50 shadow-[0_-4px_12px_rgba(0,0,0,0.03)]"
              style={{ transform: `translateY(${keyboardOffset}px)` }}
            >
              {inputMode === 'sym' ? (
                <div className="flex flex-col gap-1.5 px-0.5">
                  {(symbolPage === 1 ? SYMBOL_LAYOUT_1 : SYMBOL_LAYOUT_2).map((row, rowIndex) => (
                    <div key={rowIndex} className="flex gap-1.5 px-0.5">
                      {row.map((key, keyIndex) => {
                        if (key === 'backspace') {
                          return (
                            <button 
                              key={key}
                              onPointerDown={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); startBackspace(e as any); }}
                              onPointerUp={stopBackspace}
                              onPointerLeave={stopBackspace}
                              className="w-[12%] h-11 bg-[#D1D1D6] rounded-md flex items-center justify-center active:bg-[#C7C7CC] shadow-[0_1px_2px_rgba(0,0,0,0.1)] transform active:scale-95 transition-all"
                            >
                              <Delete className="w-5 h-5 text-gray-700" />
                            </button>
                          );
                        }
                        if (key === 'ABC') {
                          return (
                            <button key={key} onPointerDown={() => setInputMode('en')} className="w-[14%] h-11 bg-[#D1D1D6] rounded-md flex items-center justify-center text-gray-700 text-xs font-bold shadow-[0_1px_2px_rgba(0,0,0,0.1)] active:bg-[#C7C7CC]">ABC</button>
                          );
                        }
                        if (key === 'mode') {
                          return (
                            <button key={key} onPointerDown={() => handleKeyClick('mode')} className="w-[14%] h-11 bg-[#D1D1D6] rounded-md flex flex-col items-center justify-center text-gray-700 text-[8px] font-bold leading-tight shadow-[0_1px_2px_rgba(0,0,0,0.1)] active:bg-[#C7C7CC]">
                              <span>한</span>
                              <div className="w-3 h-[1px] bg-gray-400 my-0.5 rotate-[-45deg]"></div>
                              <span className="ml-1">영</span>
                            </button>
                          );
                        }
                        if (key === 'space') {
                          return (
                            <button key={key} onPointerDown={() => handleKeyClick('space')} className="flex-1 h-11 bg-white rounded-md flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.06)] active:bg-blue-50 border-b-2 border-blue-100">
                              <div className="w-16 h-1.5 bg-blue-100 rounded-full"></div>
                            </button>
                          );
                        }
                        if (key === 'enter') {
                          return (
                            <button key={key} onPointerDown={() => handleKeyClick('enter')} className="w-[14%] h-11 bg-[#D1D1D6] rounded-md flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.1)] active:bg-[#C7C7CC]">
                              <CornerDownLeft className="w-5 h-5 text-gray-700" />
                            </button>
                          );
                        }
                        if (key === '1/2') {
                          return (
                            <button key={key} onPointerDown={() => setSymbolPage(2)} className="w-[12%] h-11 bg-[#D1D1D6] rounded-md flex items-center justify-center text-gray-700 text-xs font-bold shadow-[0_1px_2px_rgba(0,0,0,0.1)] active:bg-[#C7C7CC]">1/2</button>
                          );
                        }
                        if (key === '2/2') {
                          return (
                            <button key={key} onPointerDown={() => setSymbolPage(1)} className="w-[12%] h-11 bg-[#D1D1D6] rounded-md flex items-center justify-center text-gray-700 text-xs font-bold shadow-[0_1px_2px_rgba(0,0,0,0.1)] active:bg-[#C7C7CC]">2/2</button>
                          );
                        }
                        return (
                          <button 
                            key={keyIndex}
                            onPointerDown={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); handleKeyPressStart(key); }}
                            onPointerUp={() => handleKeyPressEnd(key)}
                            onPointerLeave={() => handleKeyPressEnd(key, true)}
                            className={`flex-1 h-11 bg-white rounded-md flex items-center justify-center text-gray-800 text-lg font-medium active:bg-gray-100 shadow-[0_1px_2px_rgba(0,0,0,0.06)] transform active:scale-95 transition-all`}
                          >
                            {key}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ) : inputMode === 'en' ? (
                <div className="flex flex-col gap-1.5 px-0.5">
                  {/* Row 1: Numbers */}
                  <div className="flex gap-1.5">
                    {['1','2','3','4','5','6','7','8','9','0'].map(k => (
                      <button key={k} onPointerDown={() => handleKeyClick(k)} className="flex-1 h-10 bg-white rounded-md flex items-center justify-center text-gray-800 text-base font-medium active:bg-gray-100 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">{k}</button>
                    ))}
                  </div>
                  {/* Row 2: QWERTY */}
                  <div className="flex gap-1.5">
                    {['q','w','e','r','t','y','u','i','o','p'].map(k => (
                      <button 
                        key={k} 
                        onPointerDown={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); handleKeyPressStart(k); }}
                        onPointerUp={() => handleKeyPressEnd(k)}
                        onPointerLeave={() => handleKeyPressEnd(k, true)}
                        className="flex-1 h-11 bg-white rounded-md flex items-center justify-center text-gray-800 text-lg font-medium uppercase active:bg-gray-100 shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                      >{k}</button>
                    ))}
                  </div>
                  {/* Row 3: ASDFGHJKL */}
                  <div className="flex gap-1.5 px-[3%]">
                    {['a','s','d','f','g','h','j','k','l'].map(k => (
                      <button 
                        key={k} 
                        onPointerDown={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); handleKeyPressStart(k); }}
                        onPointerUp={() => handleKeyPressEnd(k)}
                        onPointerLeave={() => handleKeyPressEnd(k, true)}
                        className="flex-1 h-11 bg-white rounded-md flex items-center justify-center text-gray-800 text-lg font-medium uppercase active:bg-gray-100 shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                      >{k}</button>
                    ))}
                  </div>
                  {/* Row 4: Shift-ZXCVBNM-Backspace */}
                  <div className="flex gap-1.5">
                    <button onPointerDown={() => handleKeyClick('shift')} className={`w-[13%] h-11 rounded-md flex items-center justify-center transition-colors shadow-[0_1px_2px_rgba(0,0,0,0.1)] ${shiftState === 2 ? 'bg-blue-500 text-white' : shiftState === 1 ? 'bg-gray-800 text-white' : 'bg-[#D1D1D6] text-gray-700'}`}>
                      <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
                        <path d="M12 4l-8 8h5v8h6v-8h5z"/>
                        {shiftState === 2 && <rect x="4" y="2" width="16" height="2" />}
                      </svg>
                    </button>
                    <div className="flex-1 flex gap-1.5">
                      {['z','x','c','v','b','n','m'].map(k => (
                        <button 
                          key={k} 
                          onPointerDown={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); handleKeyPressStart(k); }}
                          onPointerUp={() => handleKeyPressEnd(k)}
                          onPointerLeave={() => handleKeyPressEnd(k, true)}
                          className="flex-1 h-11 bg-white rounded-md flex items-center justify-center text-gray-800 text-lg font-medium uppercase active:bg-gray-100 shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                        >{k}</button>
                      ))}
                    </div>
                    <button 
                      onPointerDown={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); startBackspace(e as any); }}
                      onPointerUp={stopBackspace}
                      onPointerLeave={stopBackspace}
                      className="w-[13%] h-11 bg-[#D1D1D6] rounded-md flex items-center justify-center active:bg-[#C7C7CC] shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
                    >
                      <Delete className="w-5 h-5 text-gray-700" />
                    </button>
                  </div>
                  {/* Row 5: Bottom Bar */}
                  <div className="flex gap-1.5">
                    <button onPointerDown={() => setInputMode('sym')} className="w-[14%] h-11 bg-[#D1D1D6] rounded-md flex items-center justify-center text-gray-700 text-xs font-bold shadow-[0_1px_2px_rgba(0,0,0,0.1)] active:bg-[#C7C7CC]">!#1</button>
                    <button onPointerDown={() => handleKeyClick('mode')} className="w-[14%] h-11 bg-[#D1D1D6] rounded-md flex flex-col items-center justify-center text-gray-700 text-[8px] font-bold leading-tight shadow-[0_1px_2px_rgba(0,0,0,0.1)] active:bg-[#C7C7CC]">
                      <span>한</span>
                      <div className="w-3 h-[1px] bg-gray-400 my-0.5 rotate-[-45deg]"></div>
                      <span className="ml-1">영</span>
                    </button>
                    <button onPointerDown={() => handleKeyClick(',')} className="w-[10%] h-11 bg-white rounded-md flex items-center justify-center text-gray-800 text-lg font-bold shadow-[0_1px_2px_rgba(0,0,0,0.06)] active:bg-gray-100">,</button>
                    <button onPointerDown={() => handleKeyClick('space')} className="flex-1 h-11 bg-white rounded-md flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.06)] active:bg-blue-50 border-b-2 border-blue-200">
                      <div className="w-16 h-1.5 bg-blue-100 rounded-full"></div>
                    </button>
                    <button onPointerDown={() => handleKeyClick('.')} className="w-[10%] h-11 bg-white rounded-md flex items-center justify-center text-gray-800 text-lg font-bold shadow-[0_1px_2px_rgba(0,0,0,0.06)] active:bg-gray-100">.</button>
                    <button onPointerDown={() => handleKeyClick('enter')} className="w-[14%] h-11 bg-[#D1D1D6] rounded-md flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.1)] active:bg-[#C7C7CC]">
                      <CornerDownLeft className="w-5 h-5 text-gray-700" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2 px-0.5 pt-1">
                  {/* Row 1 */}
                  <div className="grid grid-cols-4 gap-2">
                    {[KEYPAD_CONFIG[0], KEYPAD_CONFIG[1], KEYPAD_CONFIG[2]].map(key => (
                      <button 
                        key={key.id}
                        onPointerDown={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); handleKeyPressStart(key.id); }}
                        onPointerUp={() => handleKeyPressEnd(key.id)}
                        onPointerLeave={() => handleKeyPressEnd(key.id, true)}
                        className="h-[4.25rem] bg-white rounded-xl shadow-[0_2px_4px_rgba(0,0,0,0.05)] flex flex-col items-center justify-center active:bg-gray-50 transition-all active:scale-95 relative overflow-hidden border border-gray-100"
                      >
                        <span className="absolute top-1 right-2 text-[10px] font-bold text-gray-300">{key.id}</span>
                        <span className="text-2xl font-semibold text-gray-800">{key.label}</span>
                      </button>
                    ))}
                    <button 
                      onPointerDown={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); startBackspace(e as any); }}
                      onPointerUp={stopBackspace}
                      onPointerLeave={stopBackspace}
                      className="h-[4.25rem] bg-[#D1D1D6] rounded-xl shadow-[0_2px_4px_rgba(0,0,0,0.08)] flex items-center justify-center active:bg-[#C7C7CC] active:scale-95 transition-all text-gray-700 hover:text-red-500"
                    >
                      <Delete className="w-7 h-7" />
                    </button>
                  </div>

                  {/* Row 2 */}
                  <div className="grid grid-cols-4 gap-2">
                    {[KEYPAD_CONFIG[3], KEYPAD_CONFIG[4], KEYPAD_CONFIG[5]].map(key => (
                      <button 
                        key={key.id}
                        onPointerDown={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); handleKeyPressStart(key.id); }}
                        onPointerUp={() => handleKeyPressEnd(key.id)}
                        onPointerLeave={() => handleKeyPressEnd(key.id, true)}
                        className="h-[4.25rem] bg-white rounded-xl shadow-[0_2px_4px_rgba(0,0,0,0.05)] flex flex-col items-center justify-center active:bg-gray-50 transition-all active:scale-95 relative overflow-hidden border border-gray-100"
                      >
                        <span className="absolute top-1 right-2 text-[10px] font-bold text-gray-300">{key.id}</span>
                        <span className="text-2xl font-semibold text-gray-800">{key.label}</span>
                      </button>
                    ))}
                    <button 
                      onPointerDown={() => handleKeyClick('enter')}
                      className="h-[4.25rem] bg-[#D1D1D6] rounded-xl shadow-[0_2px_4px_rgba(0,0,0,0.08)] flex items-center justify-center active:bg-[#C7C7CC] active:scale-95 transition-all text-gray-700 hover:text-blue-600"
                    >
                      <CornerDownLeft className="w-7 h-7" />
                    </button>
                  </div>

                  {/* Row 3 */}
                  <div className="grid grid-cols-4 gap-2">
                    {[KEYPAD_CONFIG[6], KEYPAD_CONFIG[7], KEYPAD_CONFIG[8]].map(key => (
                      <button 
                        key={key.id}
                        onPointerDown={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); handleKeyPressStart(key.id); }}
                        onPointerUp={() => handleKeyPressEnd(key.id)}
                        onPointerLeave={() => handleKeyPressEnd(key.id, true)}
                        className="h-[4.25rem] bg-white rounded-xl shadow-[0_2px_4px_rgba(0,0,0,0.05)] flex flex-col items-center justify-center active:bg-gray-50 transition-all active:scale-95 relative overflow-hidden border border-gray-100"
                      >
                        <span className="absolute top-1 right-2 text-[10px] font-bold text-gray-300">{key.id}</span>
                        <span className="text-2xl font-semibold text-gray-800">{key.label}</span>
                      </button>
                    ))}
                    <button 
                      onPointerDown={() => handleKeyClick('punct')}
                      className="h-[4.25rem] bg-white rounded-xl shadow-[0_2px_4px_rgba(0,0,0,0.05)] flex items-center justify-center active:bg-gray-50 active:scale-95 transition-all text-xl font-bold text-gray-800 border border-gray-100"
                    >
                      .,?!
                    </button>
                  </div>

                  {/* Row 4 */}
                  <div className="grid grid-cols-4 gap-2 h-15">
                    <div className="flex gap-1.5">
                      <button 
                        onPointerDown={() => setInputMode('sym')}
                        className={`flex-1 rounded-xl shadow-[0_2px_4px_rgba(0,0,0,0.08)] flex items-center justify-center text-xs font-bold transition-all active:scale-95 border ${inputMode === 'sym' ? 'bg-blue-600 text-white border-blue-400' : 'bg-[#D1D1D6] text-gray-700 border-transparent'}`}
                      >
                        !#1
                      </button>
                      <button 
                        onPointerDown={() => handleKeyClick('mode')}
                        className={`flex-1 rounded-xl shadow-[0_2px_4px_rgba(0,0,0,0.08)] flex flex-col items-center justify-center text-[8px] font-bold transition-all active:scale-95 leading-tight ${inputMode === 'ko' ? 'bg-blue-50 text-blue-600 border border-blue-200 shadow-[inset_0_0_8px_rgba(37,99,235,0.1)]' : 'bg-[#D1D1D6] text-gray-700'}`}
                      >
                        <span>한글</span>
                        <div className="w-3 h-[1px] bg-gray-400 my-0.5 rotate-[-45deg]"></div>
                        <span className="ml-1">영어</span>
                      </button>
                    </div>
                    <button 
                      onPointerDown={() => handleKeyClick('0')}
                      onPointerUp={() => handleKeyPressEnd('0')}
                      onPointerLeave={() => handleKeyPressEnd('0', true)}
                      className="bg-white rounded-xl shadow-[0_2px_4px_rgba(0,0,0,0.05)] flex flex-col items-center justify-center active:bg-gray-50 transition-all active:scale-95 relative overflow-hidden border border-gray-100"
                    >
                      <span className="absolute top-1 right-2 text-[10px] font-bold text-gray-300">0</span>
                      <span className="text-2xl font-semibold text-gray-800">ㅇㅁ</span>
                    </button>
                    <button 
                      onPointerDown={() => handleKeyClick('space')}
                      className="bg-white rounded-xl shadow-[0_2px_4px_rgba(0,0,0,0.05)] flex items-center justify-center active:bg-blue-50 active:scale-95 transition-all border border-gray-100 border-b-2 border-blue-100"
                    >
                      <div className="w-12 h-1.5 bg-blue-400 rounded-full"></div>
                    </button>
                    <button 
                      onPointerDown={() => sendCommand('clear')}
                      className="bg-[#D1D1D6] rounded-xl shadow-[0_2px_4px_rgba(0,0,0,0.08)] flex items-center justify-center text-xs font-bold text-gray-700 active:bg-red-50 active:text-red-600 transition-all active:scale-95 border border-transparent"
                    >
                      지우기
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
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">감도</div>
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
                  자이로 마우스 {isAirMouseActive ? 'ON' : 'OFF'}
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
                      <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-blue-400">기기를 기울여 움직이세요</span>
                    </>
                  ) : (
                    <>
                      <MousePointer2 className="w-20 h-20 opacity-20" />
                      <span className="text-[10px] font-bold uppercase tracking-[0.3em] opacity-50">트랙패드</span>
                    </>
                  )}
                </div>
                
                <div className="absolute bottom-6 left-6 right-6 h-28 flex gap-4">
                  <button 
                    className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl active:bg-gray-200 active:scale-95 transition-all flex items-center justify-center font-bold uppercase text-[10px] tracking-widest text-gray-500 shadow-sm"
                    onClick={() => emitEvent('mouse-click', { button: 'left' })}
                  >
                    왼쪽 클릭
                  </button>
                  <button 
                    className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl active:bg-gray-200 active:scale-95 transition-all flex items-center justify-center font-bold uppercase text-[10px] tracking-widest text-gray-500 shadow-sm"
                    onClick={() => emitEvent('mouse-click', { button: 'right' })}
                  >
                    오른쪽 클릭
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
