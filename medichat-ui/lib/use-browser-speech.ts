"use client";

import { useEffect, useRef, useState } from "react";

type BrowserSpeechRecognitionAlternative = {
  transcript: string;
};

type BrowserSpeechRecognitionResult = {
  isFinal: boolean;
  length: number;
  [index: number]: BrowserSpeechRecognitionAlternative;
};

type BrowserSpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<BrowserSpeechRecognitionResult>;
};

type BrowserSpeechRecognitionErrorEvent = {
  error: string;
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onstart: ((event: Event) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: ((event: Event) => void) | null;
};

type BrowserSpeechRecognitionConstructor = {
  new (): BrowserSpeechRecognition;
};

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

function getSpeechRecognitionConstructor() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function normalizeTranscript(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function appendTranscript(base: string, addition: string) {
  const normalizedAddition = normalizeTranscript(addition);

  if (!normalizedAddition) {
    return base;
  }

  if (!base) {
    return normalizedAddition;
  }

  return `${base} ${normalizedAddition}`.trim();
}

function getFriendlySpeechError(errorCode: string) {
  switch (errorCode) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was blocked. Please allow it in your browser and try again.";
    case "audio-capture":
      return "No microphone was detected. Check your input device and try again.";
    case "network":
      return "Voice input could not reach the browser speech service. Please try again.";
    case "no-speech":
      return "No speech was detected. Try again when you are ready.";
    case "language-not-supported":
      return "This browser speech engine does not support the selected language.";
    default:
      return "Voice input ran into a problem. Please try again.";
  }
}

export function useBrowserSpeechRecognition(language = "en-IN") {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const finalTranscriptRef = useRef("");
  const suppressAbortedErrorRef = useRef(false);
  const [isListening, setIsListening] = useState(false);
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isSupported = Boolean(getSpeechRecognitionConstructor());

  useEffect(() => {
    return () => {
      suppressAbortedErrorRef.current = true;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  function startListening() {
    const SpeechRecognitionConstructor = getSpeechRecognitionConstructor();

    if (!SpeechRecognitionConstructor) {
      setError(
        "Voice input is available only in supported browsers such as Chrome or Edge."
      );
      return;
    }

    if (recognitionRef.current) {
      return;
    }

    const recognition = new SpeechRecognitionConstructor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = language;
    recognition.maxAlternatives = 1;

    finalTranscriptRef.current = "";
    suppressAbortedErrorRef.current = false;
    setError(null);
    setFinalTranscript("");
    setInterimTranscript("");
    setIsListening(true);

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      let nextFinalTranscript = "";
      let nextInterimTranscript = "";

      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const alternative = result?.[0];
        const transcript = normalizeTranscript(alternative?.transcript || "");

        if (!transcript) {
          continue;
        }

        if (result.isFinal) {
          nextFinalTranscript = appendTranscript(nextFinalTranscript, transcript);
        } else {
          nextInterimTranscript = appendTranscript(nextInterimTranscript, transcript);
        }
      }

      finalTranscriptRef.current = nextFinalTranscript;
      setFinalTranscript(nextFinalTranscript);
      setInterimTranscript(nextInterimTranscript);
      setError(null);
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted" && suppressAbortedErrorRef.current) {
        return;
      }

      setError(getFriendlySpeechError(event.error));
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      suppressAbortedErrorRef.current = false;
      setIsListening(false);
      setInterimTranscript("");
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      setError("Voice input could not start. Please try again.");
    }
  }

  function stopListening() {
    if (!recognitionRef.current) {
      setIsListening(false);
      setInterimTranscript("");
      return;
    }

    suppressAbortedErrorRef.current = true;

    try {
      recognitionRef.current.stop();
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      setInterimTranscript("");
    }
  }

  function toggleListening() {
    if (isListening) {
      stopListening();
      return;
    }

    startListening();
  }

  return {
    error,
    finalTranscript,
    interimTranscript,
    isListening,
    isSupported,
    startListening,
    stopListening,
    toggleListening,
  };
}
