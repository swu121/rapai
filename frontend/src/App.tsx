import { MicController } from './components/MicController'
import { WordGenerator } from './components/WordGenerator'
import './App.css'

function App() {
  return (
    <div className="app-layout">
      <h1 className="app-title">Rap AI</h1>
      <div className="app-columns">
        <WordGenerator />
        <MicController />
      </div>
    </div>
  )
}

export default App
