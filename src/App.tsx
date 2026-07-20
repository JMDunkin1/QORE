import { useEffect, useState } from 'react'
import { BacktestView } from './views/BacktestView'
import { CommandView } from './views/CommandView'

type View = 'command' | 'backtest'

function viewFromHash(): View {
  const hash = window.location.hash.replace('#', '')
  return hash === 'backtest' ? 'backtest' : 'command'
}

export default function App() {
  const [view, setView] = useState<View>(viewFromHash)

  useEffect(() => {
    const handleHashChange = () => setView(viewFromHash())
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const navigate = (next: View) => {
    window.location.hash = next
    setView(next)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#command" onClick={() => navigate('command')} aria-label="QORE natural gas command">
          <span>QORE</span><b>//NG</b>
        </a>
        <nav aria-label="Primary">
          <button
            type="button"
            className={view === 'command' ? 'active' : ''}
            aria-current={view === 'command' ? 'page' : undefined}
            onClick={() => navigate('command')}
          >
            COMMAND
          </button>
          <button
            type="button"
            className={view === 'backtest' ? 'active' : ''}
            aria-current={view === 'backtest' ? 'page' : undefined}
            onClick={() => navigate('backtest')}
          >
            BACKTEST
          </button>
        </nav>
      </header>

      {view === 'command' ? <CommandView /> : <BacktestView />}
    </div>
  )
}
