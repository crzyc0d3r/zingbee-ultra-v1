"use client";

import { useState, useEffect, useRef } from "react";

const THINKING_WORDS = [
  "Pondering", "Deliberating", "Contemplating", "Ruminating", "Cogitating",
  "Mulling", "Reflecting", "Meditating", "Brooding", "Speculating",
  "Computing", "Processing", "Algorithmizing", "Simulating", "Optimizing",
  "Iterating", "Compiling", "Debugging", "Neuralizing", "Vectorizing",
  "Dreaming", "Inventing", "Fabricating", "Concocting", "Imagining",
  "Fantasizing", "Weaving", "Brewing", "Sculpting", "Conjuring",
  "Hustling", "Grinding", "Cranking", "Revving", "Charging",
  "Spinning", "Whirring", "Buzzing", "Pulsing", "Thrumming",
  "Chilling", "Lounging", "Doodling", "Scribbling", "Noodling",
  "Fiddling", "Twiddling", "Dawdling", "Meandering", "Wandering",
];

function randomWord() {
  return THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)];
}

interface ThinkingIndicatorProps {
  thinkingText?: string;
}

export function ThinkingIndicator({ thinkingText }: ThinkingIndicatorProps) {
  const [word, setWord] = useState(randomWord);
  const [dots, setDots] = useState(" .");
  const [opacity, setOpacity] = useState(1);
  const dotFrames = [" .", " ..", " ...", " ...."];
  const dotIndexRef = useRef(0);

  // Dot animation every 300ms
  useEffect(() => {
    const interval = setInterval(() => {
      dotIndexRef.current = (dotIndexRef.current + 1) % dotFrames.length;
      setDots(dotFrames[dotIndexRef.current]);
    }, 300);
    return () => clearInterval(interval);
  }, []);

  // Word swap every 2-5 seconds with fade
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    const swap = () => {
      setOpacity(0);
      setTimeout(() => {
        setWord(randomWord());
        dotIndexRef.current = 0;
        setDots(dotFrames[0]);
        setOpacity(1);
      }, 150);
      timeout = setTimeout(swap, 2000 + Math.random() * 3000);
    };
    timeout = setTimeout(swap, 2000 + Math.random() * 3000);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className="thinking-indicator">
      <div className="thinking-animation">
        <div className="thinking-orbit">
          <span className="thinking-dot"></span>
          <span className="thinking-dot"></span>
          <span className="thinking-dot"></span>
        </div>
      </div>
      <span
        className="thinking-label"
        style={{ opacity, transition: "opacity 0.15s" }}
      >
        {word}{dots}
      </span>
    </div>
  );
}
