import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, ListMusic } from 'lucide-react'
import type { Playlist, PlaylistFolder } from '../types'

interface PlaylistTreeProps {
  folders: PlaylistFolder[]
  playlists: Playlist[]
  selectedPlaylistId?: string
  onOpen: (playlistId: string) => void
  defaultCollapsed?: boolean
}

interface FolderNode {
  folder: PlaylistFolder
  subfolders: FolderNode[]
  playlists: Playlist[]
  descendantTrackCount: number
  descendantPlaylistCount: number
}

function buildTree(folders: PlaylistFolder[], playlists: Playlist[]) {
  const foldersByParent = new Map<string | 'root', PlaylistFolder[]>()
  const playlistsByFolder = new Map<string | 'root', Playlist[]>()

  const knownFolderIds = new Set(folders.map(f => f.id))

  for (const folder of folders) {
    const key = folder.parentId && knownFolderIds.has(folder.parentId) ? folder.parentId : 'root'
    const list = foldersByParent.get(key) ?? []
    list.push(folder)
    foldersByParent.set(key, list)
  }

  for (const playlist of playlists) {
    const key = playlist.folderId && knownFolderIds.has(playlist.folderId) ? playlist.folderId : 'root'
    const list = playlistsByFolder.get(key) ?? []
    list.push(playlist)
    playlistsByFolder.set(key, list)
  }

  function buildNode(folder: PlaylistFolder): FolderNode {
    const subfolderList = (foldersByParent.get(folder.id) ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
    const subfolders = subfolderList.map(buildNode)

    const directPlaylists = (playlistsByFolder.get(folder.id) ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))

    const descendantTrackCount =
      directPlaylists.reduce((sum, p) => sum + (p.trackCount ?? p.items.length), 0) +
      subfolders.reduce((sum, n) => sum + n.descendantTrackCount, 0)
    const descendantPlaylistCount =
      directPlaylists.length + subfolders.reduce((sum, n) => sum + n.descendantPlaylistCount, 0)

    return {
      folder,
      subfolders,
      playlists: directPlaylists,
      descendantTrackCount,
      descendantPlaylistCount,
    }
  }

  const rootFolders = (foldersByParent.get('root') ?? [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(buildNode)
  const rootPlaylists = (playlistsByFolder.get('root') ?? [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))

  return { rootFolders, rootPlaylists }
}

export default function PlaylistTree({
  folders,
  playlists,
  selectedPlaylistId,
  onOpen,
  defaultCollapsed = false,
}: PlaylistTreeProps) {
  const { rootFolders, rootPlaylists } = useMemo(
    () => buildTree(folders, playlists),
    [folders, playlists],
  )

  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (!defaultCollapsed) return new Set()
    const ids = new Set<string>()
    const walk = (nodes: FolderNode[]) => {
      for (const node of nodes) {
        ids.add(node.folder.id)
        walk(node.subfolders)
      }
    }
    walk(rootFolders)
    return ids
  })

  function toggle(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div>
      {rootFolders.map(node => (
        <FolderRow
          key={node.folder.id}
          node={node}
          depth={0}
          collapsed={collapsed}
          onToggle={toggle}
          selectedPlaylistId={selectedPlaylistId}
          onOpen={onOpen}
        />
      ))}
      {rootPlaylists.map(playlist => (
        <PlaylistRow
          key={playlist.id}
          playlist={playlist}
          depth={0}
          selected={playlist.id === selectedPlaylistId}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}

function FolderRow({
  node,
  depth,
  collapsed,
  onToggle,
  selectedPlaylistId,
  onOpen,
}: {
  node: FolderNode
  depth: number
  collapsed: Set<string>
  onToggle: (id: string) => void
  selectedPlaylistId?: string
  onOpen: (playlistId: string) => void
}) {
  const isCollapsed = collapsed.has(node.folder.id)
  const indent = { paddingLeft: `${20 + depth * 18}px` }

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(node.folder.id)}
        className="flex w-full items-center justify-between gap-3 py-3 pr-5 text-left transition-colors hover:bg-[#fafafb] sm:pr-6"
        style={indent}
        aria-expanded={!isCollapsed}
      >
        <div className="flex min-w-0 items-center gap-2">
          {isCollapsed ? (
            <ChevronRight size={14} className="shrink-0 text-[#a2a3ad]" />
          ) : (
            <ChevronDown size={14} className="shrink-0 text-[#a2a3ad]" />
          )}
          {isCollapsed ? (
            <Folder size={14} className="shrink-0 text-[#8b8c95]" />
          ) : (
            <FolderOpen size={14} className="shrink-0 text-[#8b8c95]" />
          )}
          <span className="truncate text-sm font-medium text-[#111116]">{node.folder.name}</span>
        </div>
        <span className="shrink-0 text-xs text-[#7a7b86]">
          {node.descendantPlaylistCount} {node.descendantPlaylistCount === 1 ? 'playlist' : 'playlists'}
        </span>
      </button>

      {!isCollapsed ? (
        <div>
          {node.subfolders.map(subnode => (
            <FolderRow
              key={subnode.folder.id}
              node={subnode}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              selectedPlaylistId={selectedPlaylistId}
              onOpen={onOpen}
            />
          ))}
          {node.playlists.map(playlist => (
            <PlaylistRow
              key={playlist.id}
              playlist={playlist}
              depth={depth + 1}
              selected={playlist.id === selectedPlaylistId}
              onOpen={onOpen}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PlaylistRow({
  playlist,
  depth,
  selected,
  onOpen,
}: {
  playlist: Playlist
  depth: number
  selected: boolean
  onOpen: (playlistId: string) => void
}) {
  const indent = { paddingLeft: `${20 + depth * 18}px` }
  const count = playlist.trackCount ?? playlist.items.length
  return (
    <button
      type="button"
      onClick={() => onOpen(playlist.id)}
      style={indent}
      className={`flex w-full items-center justify-between gap-3 py-3 pr-5 text-left transition-colors sm:pr-6 ${
        selected ? 'bg-[#fce5e8]' : 'hover:bg-[#fafafb]'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="w-[14px] shrink-0" aria-hidden />
        <ListMusic size={14} className="shrink-0 text-[#a2a3ad]" />
        <span className="truncate text-sm text-[#111116]">{playlist.name}</span>
      </div>
      <span className="shrink-0 text-xs text-[#7a7b86]">{count} {count === 1 ? 'item' : 'items'}</span>
    </button>
  )
}
