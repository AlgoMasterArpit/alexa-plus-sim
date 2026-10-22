interface RecognitionAlternative {
  readonly transcript: string;
}

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: RecognitionAlternative;
}

interface RecognitionEvent {
  readonly results: ArrayLike<RecognitionResult>;
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionConstructor = new () => Recognition;

const RecognitionImpl =
  (
    window as unknown as {
      SpeechRecognition?: RecognitionConstructor;
      webkitSpeechRecognition?: RecognitionConstructor;
    }
  ).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: RecognitionConstructor })
    .webkitSpeechRecognition;

export const canListen = RecognitionImpl !== undefined;
export const canSpeak = 'speechSynthesis' in window;

export interface ListenCallbacks {
  readonly onInterim: (text: string) => void;
  readonly onFinal: (text: string) => void;
  readonly onEnd: () => void;
  readonly onError: (message: string) => void;
}

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone access was blocked. Allow it in the browser to talk.',
  'no-speech': "I didn't hear anything. Try again.",
  'audio-capture': 'No microphone was found.',
  network: 'Speech recognition needs a network connection in this browser.',
};

export class Listener {
  #recognition: Recognition | undefined;

  get active(): boolean {
    return this.#recognition !== undefined;
  }

  start(callbacks: ListenCallbacks): void {
    if (!RecognitionImpl) {
      callbacks.onError('Voice input is not supported in this browser. Type instead.');
      return;
    }
    this.stop();
    const recognition = new RecognitionImpl();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    let finalText = '';
    recognition.onresult = (event) => {
      const results = Array.from(event.results);
      finalText = results
        .filter((result) => result.isFinal)
        .map((result) => result[0].transcript)
        .join(' ')
        .trim();
      callbacks.onInterim(
        results
          .map((result) => result[0].transcript)
          .join(' ')
          .trim(),
      );
    };
    recognition.onerror = (event) => {
      if (event.error !== 'aborted') {
        callbacks.onError(ERROR_MESSAGES[event.error] ?? `Voice input failed: ${event.error}`);
      }
    };
    recognition.onend = () => {
      this.#recognition = undefined;
      if (finalText) callbacks.onFinal(finalText);
      callbacks.onEnd();
    };
    this.#recognition = recognition;
    recognition.start();
  }

  stop(): void {
    this.#recognition?.stop();
  }

  cancel(): void {
    const recognition = this.#recognition;
    this.#recognition = undefined;
    recognition?.abort();
  }
}

export function speak(text: string): Promise<void> {
  if (!canSpeak || !text) return Promise.resolve();
  speechSynthesis.cancel();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = navigator.language || 'en-US';
    utterance.rate = 1.02;
    utterance.onend = () => {
      resolve();
    };
    utterance.onerror = () => {
      resolve();
    };
    speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking(): void {
  if (canSpeak) speechSynthesis.cancel();
}

const YES = /^(yes|yeah|yep|yup|sure|ok|okay|go ahead|confirm|please do|do it|haan|ha)\b/i;
const NO = /^(no|nope|nah|cancel|don't|do not|stop|nahi|mat)\b/i;

export function interpretYesNo(text: string): 'yes' | 'no' | undefined {
  const spoken = text.trim();
  if (YES.test(spoken)) return 'yes';
  if (NO.test(spoken)) return 'no';
  return undefined;
}
