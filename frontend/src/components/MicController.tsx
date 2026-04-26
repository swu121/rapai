import { useState, useRef } from "react";
import { DeepgramClient } from "@deepgram/sdk";

type MicState = "idle" | "granted" | "denied" | "error";
type DeepgramSocket = Awaited<
  ReturnType<DeepgramClient["listen"]["v1"]["connect"]>
>;
type TranscriptResult = {
  channel?: { alternatives?: { transcript?: string }[] };
  is_final?: boolean;
};

export function MicController() {
  const [micState, setMicState] = useState<MicState>("idle");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");

  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const socketRef = useRef<DeepgramSocket | null>(null);

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
      } else {
        setInterimTranscript(text);
      }
    });

    socket.on("close", () => console.log("Deepgram disconnected"));
    socket.on("error", (err: Error) => console.error("Deepgram error:", err));

    socket.connect();
    await socket.waitForOpen();
    console.log("Deepgram connected");

    socketRef.current = socket;

    const audioContext = new AudioContext({ sampleRate: 16000 });
    console.log("actual sample rate:", audioContext.sampleRate);
    await audioContext.audioWorklet.addModule("/audio-processor.worklet.js");

    const source = audioContext.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(audioContext, "rap-processor");

    workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (socketRef.current) {
        socketRef.current.sendMedia(float32ToPcm16(e.data));
      }
    };

    source.connect(workletNode);

    audioContextRef.current = audioContext;
    workletNodeRef.current = workletNode;
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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
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

  function stopMic() {
    workletNodeRef.current?.disconnect();
    audioContextRef.current?.close();
    socketRef.current?.close();
    workletNodeRef.current = null;
    audioContextRef.current = null;
    socketRef.current = null;
    setInterimTranscript("");
    setMicState("idle");
  }

  return (
    <div>
      {micState === "idle" && (
        <button onClick={requestMic}>Enable Microphone</button>
      )}
      {micState === "granted" && (
        <>
          <p>Mic active — transcribing...</p>
          <button onClick={stopMic}>Stop Microphone</button>
          <p style={{ marginTop: "1rem", fontSize: "1.2rem" }}>
            {finalTranscript}{" "}
            <span style={{ opacity: 0.5 }}>{interimTranscript}</span>
          </p>
        </>
      )}
      {micState === "denied" && (
        <p style={{ color: "red" }}>
          Microphone permission denied. Allow it in your browser settings and
          try again.
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
