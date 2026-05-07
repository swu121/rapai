import { useState, useRef, useEffect } from "react";
import { DeepgramClient } from "@deepgram/sdk";
import { MicSettings } from "./MicSettings";

type MicState = "idle" | "granted" | "denied" | "error";
type DeepgramSocket = Awaited<
  ReturnType<DeepgramClient["listen"]["v1"]["connect"]>
>;
type DeepgramWord = { word: string; start: number; end: number };
type TranscriptResult = {
  channel?: { alternatives?: { transcript?: string; words?: DeepgramWord[] }[] };
  is_final?: boolean;
};

type Props = {
  onSessionSaved: () => void
  suggestedWords: Array<{ word: string; shownAt: number }>
}

const API = 'http://localhost:3001'

export function MicController({ onSessionSaved, suggestedWords }: Props) {
  const [micState, setMicState] = useState<MicState>("idle");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");

  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const socketRef = useRef<DeepgramSocket | null>(null);
  const startedAtRef = useRef<string | null>(null);
  const streamStartedAtRef = useRef<number | null>(null);
  const transcriptWordsRef = useRef<Array<{ word: string; start: number; end: number }>>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const volumeBarRef = useRef<HTMLDivElement>(null);

  async function enumerateDevices() {
    const all = await navigator.mediaDevices.enumerateDevices();
    const inputs = all.filter(d => d.kind === "audioinput");
    setDevices(inputs);
    setSelectedDeviceId(prev => prev || inputs[0]?.deviceId || "");
  }

  useEffect(() => {
    enumerateDevices();
    navigator.mediaDevices.addEventListener("devicechange", enumerateDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", enumerateDevices);
  }, []);

  async function startAudioPipeline(stream: MediaStream) {
    const deepgram = new DeepgramClient({
      apiKey: import.meta.env.VITE_DEEPGRAM_API_KEY,
    });

    const socket = await deepgram.listen.v1.connect({
      model: "nova-3",
      language: "en",
      encoding: "linear16",
      sample_rate: 16000,
      interim_results: "true",
      smart_format: "false",
      Authorization: `Token ${import.meta.env.VITE_DEEPGRAM_API_KEY}`,
    });

    socket.on("message", (data) => {
      if (data.type !== "Results") return;
      const result = data as unknown as TranscriptResult;
      const text = result.channel?.alternatives?.[0]?.transcript;
      if (!text) return;
      if (result.is_final) {
        setFinalTranscript((prev) => (prev ? prev + " " + text : text));
        setInterimTranscript("");
        const words = result.channel?.alternatives?.[0]?.words ?? [];
        const base = streamStartedAtRef.current ?? 0;
        for (const w of words) {
          transcriptWordsRef.current.push({
            word: w.word.toLowerCase(),
            start: base + w.start * 1000,
            end: base + w.end * 1000,
          });
        }
      } else {
        setInterimTranscript(text);
      }
    });

    socket.on("close", () => console.log("Deepgram disconnected"));
    socket.on("error", (err: Error) => console.error("Deepgram error:", err));

    socket.connect();
    await socket.waitForOpen();
    streamStartedAtRef.current = Date.now();

    socketRef.current = socket;

    const audioContext = new AudioContext({ sampleRate: 16000 });
    await audioContext.audioWorklet.addModule("/audio-processor.worklet.js");

    const source = audioContext.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(audioContext, "rap-processor");

    workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (socketRef.current) {
        socketRef.current.sendMedia(float32ToPcm16(e.data));
      }
    };

    // Volume meter
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let smoothed = 0;
    function pollVolume() {
      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (const v of dataArray) { const n = (v - 128) / 128; sum += n * n; }
      const rms = Math.sqrt(sum / dataArray.length);
      smoothed = smoothed * 0.85 + rms * 0.15;
      if (volumeBarRef.current) {
        volumeBarRef.current.style.width = `${Math.min(100, smoothed * 600)}%`;
      }
      animFrameRef.current = requestAnimationFrame(pollVolume);
    }
    pollVolume();

    source.connect(workletNode);
    audioContextRef.current = audioContext;
    workletNodeRef.current = workletNode;

    const mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    mediaRecorder.start();
    mediaRecorderRef.current = mediaRecorder;
  }

  function float32ToPcm16(float32: Float32Array): ArrayBuffer {
    const buf = new ArrayBuffer(float32.length * 2);
    const view = new DataView(buf);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }

  async function requestMic() {
    try {
      const audioConstraint = selectedDeviceId
        ? { deviceId: { exact: selectedDeviceId } }
        : true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint, video: false });
      streamRef.current = stream;
      startedAtRef.current = new Date().toISOString();
      // Re-enumerate now that permission is granted — labels become available
      await enumerateDevices();
      await startAudioPipeline(stream);
      setMicState("granted");
    } catch (err) {
      console.error("MicController error:", err);
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setMicState("denied");
      } else {
        setMicState("error");
      }
    }
  }

  async function stopMic() {
    cancelAnimationFrame(animFrameRef.current);
    if (volumeBarRef.current) volumeBarRef.current.style.width = "0%";
    analyserRef.current = null;

    const audioBlob = await new Promise<Blob | null>((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") { resolve(null); return; }
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        audioChunksRef.current = [];
        resolve(blob);
      };
      recorder.stop();
    });
    mediaRecorderRef.current = null;

    workletNodeRef.current?.disconnect();
    audioContextRef.current?.close();
    socketRef.current?.close();
    streamRef.current?.getTracks().forEach(t => t.stop());
    workletNodeRef.current = null;
    audioContextRef.current = null;
    socketRef.current = null;
    streamRef.current = null;

    const endedAt = new Date().toISOString();
    const transcript = finalTranscript.trim();

    setInterimTranscript("");
    setFinalTranscript("");
    setMicState("idle");

    if (transcript && startedAtRef.current) {
      try {
        const res = await fetch(`${API}/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript,
            started_at: startedAtRef.current,
            ended_at: endedAt,
            transcript_words: transcriptWordsRef.current,
            suggested_words: suggestedWords,
          }),
        });
        const sessionData = await res.json();

        if (audioBlob && sessionData.id) {
          try {
            const form = new FormData();
            form.append("audio", audioBlob, "recording.webm");
            await fetch(`${API}/sessions/${sessionData.id}/audio`, { method: "POST", body: form });
          } catch (err) {
            console.error("Failed to upload audio:", err);
          }
        }

        onSessionSaved();
      } catch (err) {
        console.error("Failed to save session:", err);
      }
    }

    startedAtRef.current = null;
    streamStartedAtRef.current = null;
    transcriptWordsRef.current = [];
  }

  const activeDevice = devices.find(d => d.deviceId === selectedDeviceId);
  const deviceLabel = activeDevice?.label || "Default microphone";

  return (
    <div className="mic-controller">
      {(micState === "idle" || micState === "granted") && (
        <MicSettings
          micState={micState}
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          deviceLabel={deviceLabel}
          volumeBarRef={volumeBarRef}
          onDeviceChange={setSelectedDeviceId}
          onStart={requestMic}
          onStop={stopMic}
        />
      )}

      {micState === "granted" && (
        <div className="mic-transcript">
          {finalTranscript}{" "}
          <span className="mic-transcript-interim">{interimTranscript}</span>
        </div>
      )}

      {micState === "denied" && (
        <p style={{ color: "red" }}>
          Microphone permission denied. Allow it in your browser settings and try again.
        </p>
      )}
      {micState === "error" && (
        <p style={{ color: "red" }}>
          Could not access microphone. Check that no other app is blocking it.
        </p>
      )}
    </div>
  );
}
