import { useState, useEffect, useCallback } from 'react';
import * as Hangul from 'hangul-js';

export function useCheonjiin() {
  const [composition, setComposition] = useState<string[]>([]);
  const [displayText, setDisplayText] = useState("");

  const addKey = useCallback((key: string) => {
    setComposition(prev => [...prev, key]);
  }, []);

  const backspace = useCallback(() => {
    setComposition(prev => prev.slice(0, -1));
  }, []);

  const clear = useCallback(() => {
    setComposition([]);
    setDisplayText("");
  }, []);

  useEffect(() => {
    // Cheonjiin mapping logic
    // ㅣ: 'ㅣ', ㆍ: '.', ㅡ: 'ㅡ'
    // This is a simplified version. Real Cheonjiin requires a state machine.
    // However, hangul-js can assemble characters if we provide the right jamo.
    
    // For now, let's just use a simple mapping for the 3 vowels
    // and standard consonants.
    
    const assembled = Hangul.assemble(composition);
    setDisplayText(assembled);
  }, [composition]);

  return {
    composition,
    displayText,
    addKey,
    backspace,
    clear,
    setComposition
  };
}
