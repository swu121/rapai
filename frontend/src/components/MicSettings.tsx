import type { RefObject } from 'react'

type MicState = 'idle' | 'granted'

type Props = {
  micState: MicState
  devices: MediaDeviceInfo[]
  selectedDeviceId: string
  deviceLabel: string
  volumeBarRef: RefObject<HTMLDivElement | null>
  onDeviceChange: (id: string) => void
  onStart: () => void
  onStop: () => void
}

export function MicSettings({
  micState,
  devices,
  selectedDeviceId,
  deviceLabel,
  volumeBarRef,
  onDeviceChange,
  onStart,
  onStop,
}: Props) {
  if (micState === 'idle') {
    return (
      <div className="mic-settings">
        <div className="mic-settings-row">
          <span className="mic-settings-icon">🎙</span>
          <select
            className="mic-settings-select"
            value={selectedDeviceId}
            onChange={e => onDeviceChange(e.target.value)}
          >
            {devices.length === 0 && (
              <option value="">Default microphone</option>
            )}
            {devices.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Microphone ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </div>
        <button onClick={onStart}>Start Recording</button>
      </div>
    )
  }

  return (
    <div className="mic-active">
      <div className="mic-active-header">
        <span className="mic-active-label">🎙 {deviceLabel}</span>
        <button className="mic-stop-btn" onClick={onStop}>Stop Recording</button>
      </div>
      <div className="mic-volume-track">
        <div ref={volumeBarRef} className="mic-volume-bar" style={{ width: '0%' }} />
      </div>
    </div>
  )
}
