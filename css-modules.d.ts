// TypeScript 7 reports TS2882 for a side-effect import with no type
// declaration ("Cannot find module or type declarations for side-effect import
// of './globals.css'"). TS 5.x let these pass silently.
//
// Next.js resolves stylesheet imports through its own loader pipeline, so these
// specifiers never reach the TypeScript module resolver at build time. The
// ambient declaration exists to tell the checker they are legitimate, not to
// give them a shape — hence no exported members.
declare module '*.css';
