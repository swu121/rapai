import { useState } from 'react'

type MicState = 'idle' | 'granted' | 'denied' | 'error'

function App() {
  const [micState, setMicState] = useState<MicState>('idle')
  const [stream, setStream] = useState<MediaStream | null>(null)

  async function requestMic() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      setStream(s)
      setMicState('granted')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setMicState('denied')
      } else {
        setMicState('error')
      }
    }
  }

  function stopMic() {
    stream?.getTracks().forEach(t => t.stop())
    setStream(null)
    setMicState('idle')
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Rap AI</h1>

      {micState === 'idle' && (
        <button onClick={requestMic}>Enable Microphone</button>
      )}

      {micState === 'granted' && (
        <>
          <p>Mic active — stream ready.</p>
          <button onClick={stopMic}>Stop Microphone</button>
        </>
      )}

      {micState === 'denied' && (
        <p style={{ color: 'red' }}>Microphone permission denied. Allow it in your browser settings and try again.</p>
      )}

      {micState === 'error' && (
        <p style={{ color: 'red' }}>Could not access microphone. Check that no other app is blocking it.</p>
      )}
    </div>
  )
}

export default App
