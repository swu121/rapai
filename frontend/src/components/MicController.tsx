import { useState, useRef } from "react";

type MicState = "idle" | "granted" | "denied" | "error";

export function MicController() {
  const [micState, setMicState] = useState<MicState>("idle");

  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);

  async function startAudioPipeline(stream: MediaStream) {
    const audioContext = new AudioContext({ sampleRate: 16000 });
    await audioContext.audioWorklet.addModule("/audio-processor.worklet.js");

    const source = audioContext.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(audioContext, "rap-processor");

    workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
      console.log(
        "chunk received, samples:",
        e.data.length,
        "max amplitude:",
        Math.max(...e.data).toFixed(3),
      );
    };

    source.connect(workletNode);

    audioContextRef.current = audioContext;
    workletNodeRef.current = workletNode;
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
    workletNodeRef.current = null;
    audioContextRef.current = null;
    setMicState("idle");
  }

  return (
    <div>
      {micState === "idle" && (
        <button onClick={requestMic}>Enable Microphone</button>
      )}
      {micState === "granted" && (
        <>
          <p>Mic active — audio pipeline running.</p>
          <button onClick={stopMic}>Stop Microphone</button>
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
