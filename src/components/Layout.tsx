import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Home, Library, Search, Settings, Sparkles } from 'lucide-react'
import MiniPlayer from './MiniPlayer'
import { usePlayerStore } from '../stores/playerStore'

const navItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/library', icon: Library, label: 'Library' },
  { to: '/search', icon: Search, label: 'Search' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export default function Layout() {
  const navigate = useNavigate()
  const currentTrack = usePlayerStore(s => s.currentTrack)

  return (
    <div className="flex flex-col h-full bg-surface-900 text-white">
      {/* Main content */}
      <main className="flex-1 overflow-y-auto pb-2 relative">
        <Outlet />

        {/* AI Chat FAB */}
        <button
          onClick={() => navigate('/ai')}
          className="fixed right-4 bottom-36 w-12 h-12 bg-accent hover:bg-accent-dark rounded-full flex items-center justify-center shadow-lg shadow-accent/20 transition-all hover:scale-105 z-40"
          title="Ask Sauti AI"
        >
          <Sparkles size={22} />
        </button>
      </main>

      {/* Mini player */}
      {currentTrack && <MiniPlayer />}

      {/* Bottom nav */}
      <nav className="glass border-t border-white/5 px-2 pb-[env(safe-area-inset-bottom)]">
        <div className="flex justify-around">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2 px-4 text-xs transition-colors ${
                  isActive ? 'text-accent' : 'text-gray-400 hover:text-gray-200'
                }`
              }
            >
              <Icon size={22} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
