// Side-effect CSS imports (`import './globals.css'`, `import '@hanzogui/core/reset.css'`).
// The bundler owns them; TypeScript only needs to know the specifier resolves.
// TS7 (tsgo) errors on an unresolvable side-effect import (TS2882) where tsc stayed
// silent, so the declaration lives here — one place, every stylesheet.
declare module '*.css'
