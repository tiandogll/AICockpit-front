// Give the app a real narrow viewport on a desktop, not a visually squeezed
// desktop viewport. The very same entry fills the screen on an actual phone.
const query = new URLSearchParams(window.location.search)
if (window.self === window.top && window.innerWidth > 700 && !query.has('embedded')) {
  const style = document.createElement('style')
  style.textContent = `
    * { box-sizing: border-box; }
    html, body, #app { height: 100%; margin: 0; }
    body { background: #e9eff3; }
    #app { display: flex; justify-content: center; }
    .phone-preview { width: 460px; max-width: 100%; height: 100dvh; border: 0;
      background: #f5f9f8; box-shadow: 0 0 60px #183b4614; }
  `
  document.head.append(style)
  const frame = document.createElement('iframe')
  frame.className = 'phone-preview'
  frame.title = 'AI Measure 手机端演示'
  const source = new URL(window.location.href)
  source.searchParams.set('embedded', '1')
  frame.src = source.pathname + source.search + source.hash
  frame.allow = 'fullscreen'
  const root = document.getElementById('app')!
  root.append(frame)
  // Mirror the route for refresh/bookmarks without reloading the iframe.
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return
    if (event.data?.kind !== 'ai-measure-mobile-route' || typeof event.data.path !== 'string') return
    const route = event.data.path as string
    if (!route.startsWith('/') || route.startsWith('//')) return
    const url = new URL(route, window.location.origin)
    if (url.origin !== window.location.origin) return
    url.searchParams.delete('embedded')
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  })
} else {
  void import('./main')
}
