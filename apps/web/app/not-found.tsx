export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-sm font-medium text-zinc-700">404 — Page not found</p>
      <a
        href="/"
        className="rounded px-3 py-1.5 text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
      >
        Go home
      </a>
    </div>
  )
}
