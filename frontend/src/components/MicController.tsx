import { useState, useRef } from "react";

type MicState = "idle" | "granted" | "denied" | "error";

export function MicController() {
  const [micState, setMicState] = useState<MicState>("idle");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");

  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const currentItemIdRef = useRef<string | null>(null);

  async function startAudioPipeline(stream: MediaStream) {
    const ws = new WebSocket(
      "wss://api.openai.com/v1/realtime?intent=transcription",
      [
        "realtime",
        `openai-insecure-api-key.${import.meta.env.VITE_OPENAI_API_KEY}`,
        "openai-beta.realtime-v1",
      ]
    );

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "transcription_session.update",
          session: {
            input_audio_format: "pcm16",
            input_audio_transcription: {
              model: "whisper-1",
            },
            turn_detection: { type: "server_vad" },
          },
        })
      );
      console.log("OpenAI Whisper Realtime connected");
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as {
        type: string;
        item_id?: string;
        delta?: string;
        transcript?: string;
      };

      if (msg.type === "conversation.item.input_audio_transcription.delta") {
        if (msg.item_id !== currentItemIdRef.current) {
          currentItemIdRef.current = msg.item_id ?? null;
          setInterimTranscript(msg.delta ?? "");
        } else {
          setInterimTranscript((prev) => prev + (msg.delta ?? ""));
        }
      } else if (
        msg.type === "conversation.item.input_audio_transcription.completed"
      ) {
        const text = msg.transcript ?? "";
        if (text) {
          setFinalTranscript((prev) => (prev ? prev + " " + text : text));
        }
        setInterimTranscript("");
        currentItemIdRef.current = null;
      } else if (msg.type === "error") {
        console.error("OpenAI Realtime error:", msg);
      }
    };

    ws.onclose = () => console.log("OpenAI Whisper disconnected");
    ws.onerror = (err) => console.error("OpenAI Realtime WS error:", err);

    wsRef.current = ws;

    const audioContext = new AudioContext({ sampleRate: 24000 });
    await audioContext.audioWorklet.addModule("/audio-processor.worklet.js");

    const source = audioContext.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(audioContext, "rap-processor");

    workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: arrayBufferToBase64(float32ToPcm16(e.data)),
          })
        );
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

  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
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
    wsRef.current?.close();
    workletNodeRef.current = null;
    audioContextRef.current = null;
    wsRef.current = null;
    currentItemIdRef.current = null;
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
