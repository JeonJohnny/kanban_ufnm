export function AppVersion() {
  return <p aria-label="사이트 버전" className="text-center text-xs text-muted-foreground">v{__APP_VERSION__} · {__BUILD_ID__}</p>
}
